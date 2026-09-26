const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { directory, readLive, writeLive } = require('../src/live-control')
const { validateOwner, privateSender } = require('./live-lab')

async function main() {
  fs.mkdirSync(directory, { recursive: true })
  const lock = path.join(directory, 'runner.pid')
  if (fs.existsSync(lock)) {
    let running = false
    try { process.kill(Number(fs.readFileSync(lock)), 0); running = true } catch { /* stopped */ }
    if (running) throw Error('A live scanner is already running')
  }
  fs.writeFileSync(lock, String(process.pid))
  process.once('exit', () => {
    if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock)
  })
  const owner = JSON.parse(fs.readFileSync(path.join(directory, '../design-lab/owner.json')))
  validateOwner(owner)
  const env = require('dotenv').parse(fs.readFileSync(path.join(directory, '../../.env.design')))
  if (!env.DESIGN_BOT_TOKEN) throw Error('Missing private test bot token')
  let control = readLive('control.json')
  if (process.argv.includes('--start')) {
    control = { enabled: true, mode: 'all-types', session: randomUUID().slice(0, 8),
      startedAt: new Date().toISOString(), expiresAt: null, maxMessages: null, intervalMs: 5000 }
    writeLive('control.json', control)
  }
  if (!control?.enabled || control.mode !== 'all-types' || !/^[a-f0-9]{8}$/.test(control.session)) throw Error('Start an all-types session with --start')
  process.env.MONGODB_URI = `mongodb://127.0.0.1:27018/ton-notify-live-${control.session}`
  process.env.BOT_TOKEN = env.DESIGN_BOT_TOKEN
  process.env.NOTIFICATIONS_CHANNEL_ID = ''
  process.env.SEND_NOTIFICATIONS = 'false'
  process.env.TON_REQUESTS_PER_SECOND = '20'
  process.env.HEALTH_DIRECTORY = path.join(directory, 'health')
  const { Api } = require('grammy')
  const { mongoose, Address, User, Delivery, Counter } = require('../src/models')
  const { config } = require('../src/config')
  const { TonCenter } = require('../src/toncenter')
  const { routeAction, sendPending } = require('../src/scanner')
  const { FEED_TYPES, chooseSample, createPageLoader } = require('../src/live-feed')
  const { connectDatabase, shutdownSignal, workerLoop, safeError } = require('../src/runtime')
  const controller = new AbortController()
  shutdownSignal().addEventListener('abort', () => controller.abort(), { once: true })
  const active = () => {
    const current = readLive('control.json')
    return !controller.signal.aborted && current?.enabled && current.session === control.session
  }
  const stopper = setInterval(() => { if (!active()) controller.abort() }, 1000)
  const file = `session-${control.session}.json`
  const session = readLive(file, { startedAt: control.startedAt, mode: control.mode, messages: {}, sent: 0 })
  let currentStatus = 'starting', feed = { types: {} }, nextSendAt = 0
  const status = () => writeLive('status.json', { status: currentStatus, mode: control.mode,
    session: control.session, sent: session.sent, maxMessages: null, intervalMs: control.intervalMs,
    types: FEED_TYPES.length, availableTypes: Object.values(feed.types).filter(value => value.selected).length,
    retryingTypes: Object.entries(feed.types).filter(([, value]) => value.failures).map(([type]) => type),
    pid: process.pid, updatedAt: new Date().toISOString() })
  try {
    status()
    if (!await connectDatabase(controller.signal, 'live')) return
    await Delivery.collection.createIndex({ status: 1, address_id: 1, next_attempt_at: 1 })
    // This TTL belongs only to the disposable live database; cursor records persist.
    await Delivery.collection.createIndex({ sent_at: 1 }, { expireAfterSeconds: 7 * 86400 })
    await User.updateOne({ user_id: owner.userId }, { $set: { first_name: 'Private live test', is_blocked: false, is_deactivated: false } }, { upsert: true })
    feed = (await Counter.findOne({ name: 'live_feed_v1' }).lean())?.data || { types: {} }
    feed.types ||= {}
    const api = new Api(config.botToken, { timeoutSeconds: 30 })
    if ((await api.getMe()).id !== owner.botId) throw Error('Bot does not match private owner')
    const client = new TonCenter({ attempts: 2, concurrency: 4 })
    const loadPage = createPageLoader(client)
    const records = new Map()
    for (const type of FEED_TYPES) {
      const id = new mongoose.Types.ObjectId(createHash('sha256').update(`live-feed:${type}`).digest('hex').slice(0, 24))
      records.set(type, id)
    }
    const persistType = async type => Counter.updateOne({ name: 'live_feed_v1' },
      { $set: { [`data.types.${type}`]: feed.types[type] } }, { upsert: true })
    session.sent = Math.max(session.sent || 0, await Delivery.countDocuments({ status: 'sent' }))
    const lastSentAt = Math.max(0, ...Object.values(session.messages).map(value => Date.parse(value.at) || 0))
    nextSendAt = lastSentAt + control.intervalMs
    if (!session.introduced && active()) {
      await api.sendMessage(owner.chatId,
        'Включён непрерывный поток всех доступных типов событий.\n\nСначала — последняя доступная операция каждого типа, затем свежие. Публичные адреса выбираются автоматически; это выборка для просмотра, а не все транзакции сети. Типы чередуются, максимум одно уведомление в 5 секунд. Без ограничения по времени и числу сообщений.\n\n/live_stop — остановить\n/live_status — статус\nЗамечания можно писать ответом на сообщение.',
        { disable_notification: true, reply_markup: { inline_keyboard: [[{ text: '⏹ Остановить поток', callback_data: 'live:stop' }]] } })
      session.introduced = true; writeLive(file, session)
    }
    const sender = privateSender(api, owner, active, async message => {
      session.sent += 1; nextSendAt = Date.now() + control.intervalMs
      session.messages[message.message_id] = { at: new Date().toISOString() }
      session.messages = Object.fromEntries(Object.entries(session.messages).slice(-5000))
      // Telegram has already accepted the message; bookkeeping cannot undo that.
      try { writeLive(file, session); status() } catch (error) { console.error(safeError(error)) }
    })
    const deliveryState = {}
    currentStatus = 'running'; status()
    await Promise.all([
      workerLoop('live-discovery', async () => {
        if (!active()) return {}
        const pending = new Set((await Delivery.find({ status: { $in: ['pending', 'sending'] } }).select('address_id').lean()).map(item => item.address_id))
        const due = FEED_TYPES.filter(type => !pending.has(String(records.get(type))) && (feed.types[type]?.nextPollAt || 0) <= Date.now())
          .sort((a, b) => (feed.types[a]?.lastPollAt || 0) - (feed.types[b]?.lastPollAt || 0)).slice(0, 4)
        const pages = await Promise.allSettled(due.map(type => loadPage(type)))
        for (const [index, type] of due.entries()) {
          if (!active()) break
          const state = feed.types[type] ||= { selected: 0, lastLt: '0' }
          state.lastPollAt = Date.now()
          const result = pages[index]
          if (result.status === 'rejected') {
            state.failures = (state.failures || 0) + 1
            state.lastError = safeError(result.reason).slice(0, 300)
            state.nextPollAt = Date.now() + Math.min(30000 * 2 ** Math.min(state.failures - 1, 4), 300000)
            await persistType(type); continue
          }
          state.failures = 0; delete state.lastError
          state.nextPollAt = Date.now() + 20000
          const ids = result.value.actions.map(action => action.action_id).filter(Boolean)
          const used = new Set((await Delivery.find({ action_id: { $in: ids }, address_id: String(records.get(type)) }).select('action_id').lean()).map(item => item.action_id))
          const sample = chooseSample(result.value, type, state, used)
          if (sample) {
            const record = { _id: records.get(type), address: sample.address, user_id: owner.userId,
              tag: '', is_deleted: false, notifications: { is_enabled: true } }
            await Address.updateOne({ _id: record._id }, { $set: record }, { upsert: true })
            await routeAction(sample.action, sample.metadata, { map: new Map([[sample.address, [record]]]), active: new Set([owner.userId]) })
            state.lastLt = sample.lt; state.selected += 1; state.lastEventAt = sample.action.end_utime
          }
          await persistType(type)
        }
        status()
        return { checked: due.length, queuedTypes: pending.size, selected: Object.values(feed.types).reduce((sum, state) => sum + (state.selected || 0), 0) }
      }, { signal: controller.signal, intervalMs: 1000 }),
      workerLoop('live-delivery', async () => {
        if (!active()) return {}
        status()
        if (Date.now() < nextSendAt) return { sent: session.sent }
        const user = await User.findOne({ user_id: owner.userId }).lean()
        if (user?.is_blocked || user?.is_deactivated) {
          writeLive('control.json', { ...control, enabled: false }); controller.abort(); return { blocked: true }
        }
        await sendPending(sender, deliveryState, { maxMessages: 1, chatId: owner.chatId })
        return { sent: session.sent }
      }, { signal: controller.signal, intervalMs: 1000 }),
    ])
    currentStatus = 'stopped'; status()
  } finally { clearInterval(stopper); await mongoose.disconnect() }
}

if (require.main === module) main().catch(error => {
  const { safeError } = require('../src/runtime')
  const errorText = safeError(error)
  const status = readLive('status.json', {})
  writeLive('status.json', { ...status, status: 'failed', error: errorText, updatedAt: new Date().toISOString() })
  console.error(errorText); process.exitCode = 1
})
module.exports = { main }
