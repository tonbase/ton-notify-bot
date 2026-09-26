const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Api } = require('grammy')
const { directory, readLive, writeLive } = require('../src/live-control')

function validateOwner(owner) {
  if (!Number.isSafeInteger(owner?.userId) || owner.userId <= 0 || owner.userId !== owner.chatId
    || !Number.isSafeInteger(owner.botId)) throw new Error('Invalid registered private owner')
}

function privateSender(api, owner, isEnabled, onSent) {
  validateOwner(owner)
  const send = (method) => async (chatId, body, options) => {
    if (chatId !== owner.chatId) throw { error_code: 400, description: 'Live recipient is not the registered owner' }
    if (!isEnabled()) throw { error_code: 429, description: 'Live session stopped', parameters: { retry_after: 60 } }
    const result = await api[method](owner.chatId, body, { ...options, disable_notification: true })
    await onSent(result)
    return result
  }
  return { sendMessage: send('sendMessage'), sendRichMessage: send('sendRichMessage') }
}

async function main() {
  fs.mkdirSync(directory, { recursive: true })
  const lock = path.join(directory, 'runner.pid')
  if (fs.existsSync(lock)) {
    let running = false
    try { process.kill(Number(fs.readFileSync(lock, 'utf8')), 0); running = true } catch { /* stopped */ }
    if (running) throw new Error('Live scanner already running')
  }
  fs.writeFileSync(lock, String(process.pid))
  process.once('exit', () => {
    if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock)
  })
  const owner = JSON.parse(fs.readFileSync(path.join(directory, '..', 'design-lab', 'owner.json'), 'utf8'))
  validateOwner(owner)
  const env = require('dotenv').parse(fs.readFileSync(path.join(directory, '..', '..', '.env.design')))
  if (!env.DESIGN_BOT_TOKEN) throw new Error('Missing private design bot token')
  let control = readLive('control.json')
  if (process.argv.includes('--start')) {
    control = { enabled: true, session: randomUUID().slice(0, 8), startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), maxMessages: 30, intervalMs: 20000 }
    writeLive('control.json', control)
  }
  if (!control?.enabled || !/^[a-f0-9]{8}$/.test(control.session)) throw new Error('Start a live session with --start')
  // An isolated local database and this bot's owner are the only live destinations.
  process.env.MONGODB_URI = `mongodb://127.0.0.1:27018/ton-notify-live-${control.session}`
  process.env.BOT_TOKEN = env.DESIGN_BOT_TOKEN
  process.env.NOTIFICATIONS_CHANNEL_ID = ''
  process.env.SEND_NOTIFICATIONS = 'false'
  process.env.TON_REQUESTS_PER_SECOND = '30'
  process.env.HEALTH_DIRECTORY = path.join(directory, 'health')
  const { config } = require('../src/config')
  config.startSeqno = null
  const { mongoose, Address, User, Delivery, TraceTask } = require('../src/models')
  const { TonCenter } = require('../src/toncenter')
  const { participants } = require('../src/events')
  const { rawAddress } = require('../src/address')
  const { loadWatched, routeAction, scanCycle, reconcileTraces, sendPending } = require('../src/scanner')
  const { shutdownSignal, connectDatabase, workerLoop, safeError } = require('../src/runtime')
  const controller = new AbortController()
  shutdownSignal().addEventListener('abort', () => controller.abort(), { once: true })
  const signal = controller.signal
  const active = () => readLive('control.json')?.enabled && Date.now() < Date.parse(control.expiresAt) && !signal.aborted
  if (!await connectDatabase(signal, 'live')) return
  try {
    const api = new Api(config.botToken, { timeoutSeconds: 30 })
    if ((await api.getMe()).id !== owner.botId) throw new Error('Bot does not match registered owner')
    await Delivery.collection.createIndex({ status: 1, next_attempt_at: 1, created_at: 1 })
    await TraceTask.collection.createIndex({ status: 1, next_attempt_at: 1 })
    const client = new TonCenter()
    const sessionFile = `session-${control.session}.json`
    let session = readLive(sessionFile)
    if (!session) {
      const samples = []
      for (const [type, label] of [['ton_transfer', 'GRAM'], ['jetton_transfer', 'Токен'], ['nft_transfer', 'NFT'], ['jetton_swap', 'Обмен']]) {
        const page = await client.actions({ action_type: type, limit: 20, sort: 'desc', include_accounts: true })
        const action = page.actions.find(item => item.success !== false && participants(item).some(address => address.startsWith('0:')))
        if (!action) throw new Error(`No recent ${type} operation found`)
        const d = action.details || {}
        const address = rawAddress(d.real_old_owner || d.sender || d.source || d.old_owner || d.receiver || d.new_owner)
          || participants(action).find(value => value.startsWith('0:'))
        samples.push({ type, label, address, action, metadata: page.metadata || {} })
      }
      await User.updateOne({ user_id: owner.userId }, { $set: { first_name: 'Private live test', is_blocked: false, is_deactivated: false } }, { upsert: true })
      for (const sample of samples) await Address.updateOne({ user_id: owner.userId, address: sample.address },
        { $set: { tag: '', is_deleted: false, 'notifications.is_enabled': true } }, { upsert: true })
      const watched = await loadWatched()
      for (const sample of samples) await routeAction(sample.action, sample.metadata, watched)
      session = { startedAt: control.startedAt, addresses: samples.map(({ address, type, label }) => ({ address, type, label })),
        samples: samples.map(({ action, type }) => ({ type, actionId: action.action_id, at: action.end_utime })), messages: {} }
      writeLive(sessionFile, session)
    }
    let sent = Math.max(await Delivery.countDocuments({ status: 'sent' }), Object.keys(session.messages).length)
    const lastSentAt = Math.max(0, ...Object.values(session.messages).map(message => Date.parse(message.at) || 0))
    let nextSendAt = Math.max(Date.now(), lastSentAt + control.intervalMs)
    const scannerState = {}, deliveryState = {}
    const status = (value) => writeLive('status.json', { status: value, session: control.session, sent,
      maxMessages: control.maxMessages, addresses: session.addresses.length, pid: process.pid,
      seqno: scannerState.lastProcessed, tip: scannerState.tip, updatedAt: new Date().toISOString() })
    if (!session.introduced && active()) {
      await api.sendMessage(owner.chatId, 'Включил реальные уведомления из блокчейна.\n\nСначала придут четыре недавние операции: GRAM, токен, NFT и обмен. Затем — новые события выбранных публичных адресов. Эти кошельки не твои; суммы и ссылки настоящие.\n\nДо 30 сообщений, не чаще одного в 20 секунд. Сеанс завершится через час или по лимиту. Замечания можно писать ответом на сообщение.\n/live_status — статус · /live_stop — остановить.',
        { disable_notification: true, reply_markup: { inline_keyboard: [[{ text: '⏹ Остановить поток', callback_data: 'live:stop' }]] } })
      session.introduced = true; writeLive(sessionFile, session)
    }
    const sender = privateSender(api, owner, () => active() && sent < control.maxMessages, async (message) => {
      sent += 1; nextSendAt = Date.now() + control.intervalMs
      session.messages[message.message_id] = { at: new Date().toISOString() }
      // A bookkeeping failure after Telegram accepted a message must not retry it.
      try { writeLive(sessionFile, session); status('running') } catch (error) { console.error(safeError(error)) }
    })
    status('running')
    const guard = () => {
      if (active() && sent < control.maxMessages) return true
      controller.abort(); return false
    }
    await Promise.all([
      workerLoop('scanner', async () => {
        if (!guard()) return {}
        await scanCycle(client, scannerState)
        status('running')
        const lag = scannerState.tip - scannerState.lastProcessed
        return { seqno: scannerState.lastProcessed, tip: scannerState.tip, lag, catchingUp: lag > 0 }
      }, { signal, intervalMs: config.scanIntervalMs }),
      workerLoop('traces', () => guard() ? reconcileTraces(client) : {}, { signal, intervalMs: 5000 }),
      workerLoop('delivery', async () => {
        if (!guard() || Date.now() < nextSendAt) return { sent }
        await sendPending(sender, deliveryState, { maxMessages: 1, chatId: owner.chatId })
        return { sent }
      }, { signal, intervalMs: 1000 }),
    ])
    status(sent >= control.maxMessages ? 'complete' : 'stopped')
    console.log(`Live session finished; ${sent} notifications accepted`)
  } finally { await mongoose.disconnect() }
}

if (require.main === module) main().catch(error => {
  const { safeError } = require('../src/runtime')
  const message = safeError(error)
  const status = readLive('status.json', {})
  writeLive('status.json', { ...status, status: 'failed', error: message, updatedAt: new Date().toISOString() })
  console.error(message); process.exitCode = 1
})
module.exports = { validateOwner, privateSender }
