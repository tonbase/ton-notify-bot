const crypto = require('node:crypto')
const { Api } = require('grammy')
const { config, requireBotToken } = require('./config')
const { mongoose, Address, User, Counter, Delivery, TraceTask } = require('./models')
const { rawAddress } = require('./address')
const { participants, formatNotification, passesFilters } = require('./events')
const { toNano } = require('./amount')
const { TonCenter, sleep } = require('./toncenter')
const { safeError, shutdownSignal, connectDatabase, workerLoop, health } = require('./runtime')

const CURSOR_NAME = 'actions_scan_v1'

function deliveryId(actionId, recipient) {
  return crypto.createHash('sha256').update(`${actionId}|${recipient}`).digest('hex')
}

async function enqueue(action, recipient, notification, record) {
  const id = deliveryId(action.action_id, record ? String(record._id) : `channel:${recipient}`)
  try {
    await Delivery.updateOne({ _id: id }, { $setOnInsert: {
      _id: id, status: 'pending', attempts: 0, chat_id: recipient,
      user_id: record ? String(record.user_id) : '',
      address_id: record ? String(record._id) : '',
      action_id: action.action_id, text: notification.text, rich_html: notification.richHtml,
      created_at: new Date(), next_attempt_at: new Date(0),
    } }, { upsert: true })
  } catch (error) {
    if (error.code !== 11000) throw error
  }
}

async function loadWatched() {
  const records = await Address.find({ is_deleted: false, 'notifications.is_enabled': true }).lean()
  const map = new Map()
  for (const record of records) {
    const raw = rawAddress(record.address)
    if (!raw) continue
    if (!map.has(raw)) map.set(raw, [])
    map.get(raw).push(record)
  }
  const users = await User.find({ user_id: { $in: [...new Set(records.map((record) => record.user_id))] } },
    { user_id: 1, is_blocked: 1, is_deactivated: 1 }).lean()
  const active = new Set(users.filter((user) => !user.is_blocked && !user.is_deactivated).map((user) => user.user_id))
  return { map, active }
}

function channelEligible(action) {
  if (!config.channelId || action.type !== 'ton_transfer' || action.success === false) return false
  const minimum = toNano(config.minChannelTon)
  if (minimum === null) return false
  try { return BigInt(action.details?.value || '0') >= BigInt(minimum) }
  catch { return false }
}

async function routeAction(action, metadata, watched, excluded = new Set()) {
  if (!action.action_id || typeof action.action_id !== 'string') throw new Error('Action without action_id')
  const matching = new Map()
  for (const participant of participants(action)) {
    if (excluded.has(participant)) continue
    for (const record of watched.map.get(participant) || []) matching.set(String(record._id), record)
  }
  for (const record of matching.values()) {
    if (!watched.active.has(record.user_id) || !passesFilters(record, action)) continue
    await enqueue(action, record.user_id, formatNotification(action, record.address, record, metadata), record)
  }
  if (channelEligible(action)) {
    await enqueue(action, config.channelId, formatNotification(action, action.details.source || action.details.destination, null, metadata), null)
  }
}

async function scanBlock(client, seqno, watched) {
  let offset = 0
  const entries = []
  let lastPageId = null
  for (;;) {
    const page = await client.actions({ mc_seqno: seqno, limit: config.pageSize, offset, sort: 'asc', include_accounts: true })
    if (offset && page.actions[0]?.action_id === lastPageId) {
      throw new Error(`Indexer returned duplicate page for block ${seqno}`)
    }
    for (const action of page.actions) entries.push({ action, metadata: page.metadata || {} })
    if (page.actions.length < config.pageSize) break
    lastPageId = page.actions[0]?.action_id
    offset += page.actions.length
    if (offset > 1000000) throw new Error(`Block ${seqno} exceeded action safety limit`)
  }
  await routeEntries(entries, watched)
  offset = 0
  const transactions = []
  let lastTransactionId = null
  for (;;) {
    const page = await client.transactionsByMasterchainBlock({ seqno, limit: config.pageSize, offset, sort: 'asc' })
    if (offset && page.transactions[0]?.hash === lastTransactionId) throw new Error(`Duplicate transaction page for block ${seqno}`)
    transactions.push(...page.transactions)
    if (page.transactions.length < config.pageSize) break
    lastTransactionId = page.transactions[0]?.hash
    offset += page.transactions.length
    if (offset > 1000000) throw new Error(`Block ${seqno} exceeded transaction safety limit`)
  }
  // A transaction can belong to a trace ending in a later block. Persist its
  // reconciliation before committing this block instead of emitting it twice.
  for (const tx of transactions) {
    const relevant = [tx.account, tx.in_msg?.source, tx.in_msg?.destination,
      ...(tx.out_msgs || []).flatMap((msg) => [msg.source, msg.destination])]
      .some((address) => watched.map.has(rawAddress(address)))
    if (!relevant) continue
    const id = tx.trace_id || tx.hash
    if (!id) throw new Error('Transaction has neither trace ID nor hash')
    try {
      await TraceTask.updateOne({ _id: id }, { $setOnInsert: {
        trace_id: tx.trace_id, tx_hash: tx.hash, status: 'pending', attempts: 0,
        created_at: new Date(), next_attempt_at: new Date(0),
      } }, { upsert: true })
    } catch (error) { if (error.code !== 11000) throw error }
  }
  return entries.length
}

async function routeEntries(entries, watched) {
  const covered = new Map()
  for (const { action } of entries) {
    if (!action.trace_id || ['call_contract', 'gasless_request', 'excess'].includes(action.type)) continue
    if (!covered.has(action.trace_id)) covered.set(action.trace_id, new Map())
    const accounts = covered.get(action.trace_id)
    for (const account of participants(action)) {
      if (!accounts.has(account)) accounts.set(account, new Set())
      for (const hash of action.transactions || []) accounts.get(account).add(hash)
    }
  }
  for (const { action, metadata } of entries) {
    const excluded = new Set()
    if (shouldSuppress(action, covered) && action.transactions?.length) {
      for (const [account, hashes] of covered.get(action.trace_id)) {
        if (action.transactions.every((hash) => hashes.has(hash))) excluded.add(account)
      }
    }
    await routeAction(action, metadata, watched, excluded)
  }
}

async function reconcileTraces(client) {
  const tasks = await TraceTask.find({ status: 'pending', next_attempt_at: { $lte: new Date() } })
    .sort({ next_attempt_at: 1 }).limit(20).lean()
  if (!tasks.length) return { pendingChecked: 0 }
  const watched = await loadWatched()
  for (const task of tasks) {
    // Schedule before network I/O; one failing trace cannot starve later tasks.
    await TraceTask.updateOne({ _id: task._id }, { $inc: { attempts: 1 },
      $set: { next_attempt_at: new Date(Date.now() + Math.min(10000 * 2 ** Math.min(task.attempts, 8), 3600000)) } })
    const page = await client.get('/traces', {
      ...(task.trace_id ? { trace_id: task.trace_id } : { tx_hash: task.tx_hash }), limit: 1,
    })
    if (!Array.isArray(page.traces)) throw new Error('Invalid traces response')
    const trace = page.traces[0]
    if (!trace || trace.is_incomplete || trace.trace_info?.trace_state !== 'complete'
      || trace.trace_info.pending_messages > 0) continue
    const entries = []
    let lastPageId = null
    for (let offset = 0; ; offset += config.pageSize) {
      const actions = await client.actions({ trace_id: trace.trace_id, include_accounts: true,
        sort: 'asc', offset, limit: config.pageSize })
      if (offset && actions.actions[0]?.action_id === lastPageId) throw new Error('Duplicate trace action page')
      entries.push(...actions.actions.map((action) => ({ action, metadata: actions.metadata || {} })))
      if (actions.actions.length < config.pageSize) break
      lastPageId = actions.actions[0]?.action_id
      if (offset >= 1000000) throw new Error('Trace action safety limit exceeded')
    }
    // The indexer may expose complete traces before their classifier catches up.
    if (!entries.length && trace.trace_info.classification_state !== 'classified') continue
    await routeEntries(entries, watched)
    const transactions = Object.values(trace.transactions || {})
    const expected = trace.trace_info.transactions
    if (!transactions.length || (expected && transactions.length < expected)) continue
    for (const action of rawFallbacks(transactions, entries.map((entry) => entry.action))) {
      await routeAction(action, page.metadata || {}, watched)
    }
    await TraceTask.updateOne({ _id: task._id }, { $set: { status: 'done' } })
  }
  return { pendingChecked: tasks.length }
}

function shouldSuppress(action, significantTraces) {
  return ['call_contract', 'gasless_request', 'excess'].includes(action.type)
    && Boolean(action.trace_id) && significantTraces.has(action.trace_id)
}

function rawFallbacks(transactions, actions) {
  const coveredTransactions = new Set(actions.flatMap((action) => action.transactions || []))
  const coveredMessages = new Set(transactions.filter((tx) => coveredTransactions.has(tx.hash))
    .flatMap((tx) => [tx.in_msg, ...(tx.out_msgs || [])]).map((message) => message?.hash).filter(Boolean))
  const seenMessages = new Set()
  const fallback = []
  for (const tx of transactions) {
    if (coveredTransactions.has(tx.hash)) continue
    let emitted = false
    const messages = [tx.in_msg, ...(tx.out_msgs || [])]
    for (const [index, message] of messages.entries()) {
      if (!message || (message.hash && (coveredMessages.has(message.hash) || seenMessages.has(message.hash)))) continue
      const source = rawAddress(message.source)
      const destination = rawAddress(message.destination || tx.account)
      if (!source && index === 0 && (tx.out_msgs || []).length) continue
      if (!source && !destination) continue
      if (message.hash) seenMessages.add(message.hash)
      fallback.push({
        action_id: `raw-message:${message.hash || `${tx.hash}:${index}`}`,
        trace_id: tx.trace_id,
        type: 'raw_message', success: !tx.description?.aborted,
        details: {
          source, destination, value: message.value || '0',
          comment: message.message_content?.decoded?.comment || '',
        }, transactions: [tx.hash],
      })
      emitted = true
    }
    if (!emitted && !messages.some(Boolean) && rawAddress(tx.account)) {
      fallback.push({ action_id: `raw-tx:${tx.hash}`, trace_id: tx.trace_id,
        type: 'account_update', success: !tx.description?.aborted,
        details: { account: rawAddress(tx.account) }, transactions: [tx.hash] })
    }
  }
  return fallback
}

async function scanCycle(client, state = {}) {
  const { last } = await client.masterchainInfo()
  const tip = last.seqno - config.lagBlocks
  state.tip = tip
  if (tip < 0) return state
  const cursor = await Counter.findOne({ name: CURSOR_NAME }).lean()
  let seqno = cursor?.data?.seqno
  if (!Number.isSafeInteger(seqno)) {
    const legacy = config.startSeqno === null
      ? await Counter.findOne({ name: 'lastCheckedBlock' }).lean() : null
    seqno = config.startSeqno !== null ? config.startSeqno - 1
      : Number.isSafeInteger(legacy?.data?.seqno) ? Math.max(0, legacy.data.seqno - 1) : tip
    await Counter.updateOne({ name: CURSOR_NAME }, { $set: { data: { seqno } } }, { upsert: true })
    console.log(`Scanner cursor initialized at ${seqno}`)
  }
  state.lastProcessed = seqno
  const watched = await loadWatched()
  const end = Math.min(tip, seqno + 40)
  for (let start = seqno + 1; start <= end; start += config.blockConcurrency) {
    const blocks = Array.from({ length: Math.min(config.blockConcurrency, end - start + 1) }, (_, i) => start + i)
    const results = await Promise.allSettled(blocks.map((block) => scanBlock(client, block, watched)))
    // Concurrent fetches/writes may complete out of order. Commit only the
    // contiguous successful prefix; replay deduplicates later saved blocks.
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') throw result.reason
      await Counter.updateOne({ name: CURSOR_NAME }, { $max: { 'data.seqno': blocks[index] } })
      state.lastProcessed = blocks[index]
    }
  }
  const lastProcessed = state.lastProcessed || seqno
  if (config.replayBlocks > 0 && lastProcessed > 0 && tip - lastProcessed <= config.replayBlocks * 2) {
    if (state.replayWindowEnd === undefined || state.replayOffset >= config.replayBlocks) {
      state.replayWindowEnd = lastProcessed
      state.replayOffset = 0
    }
    const replay = Math.max(1, state.replayWindowEnd - state.replayOffset)
    await scanBlock(client, replay, watched)
    state.replayOffset += 1
  }
  return state
}

async function sendPending(api, state = {}, { maxMessages = 100, chatId } = {}) {
  if (!Number.isSafeInteger(maxMessages) || maxMessages < 1) throw new Error('Invalid delivery batch size')
  let sent = 0
  if (state.cooldownUntil > Date.now()) return sent
  state.chats ||= new Map()
  for (const [chat, until] of state.chats) if (until <= Date.now()) state.chats.delete(chat)
  for (let examined = 0; examined < 100; examined += 1) {
    const now = new Date()
    const delivery = await Delivery.findOneAndUpdate({
      ...(chatId === undefined ? {} : { chat_id: chatId }),
      status: { $in: ['pending', 'sending'] },
      next_attempt_at: { $lte: now },
      $or: [{ status: 'pending' }, { lease_until: { $lte: now } }],
    }, { $set: { status: 'sending', lease_until: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } },
    { sort: { created_at: 1 }, new: true })
    if (!delivery) break
    const nextChatAt = state.chats.get(String(delivery.chat_id)) || 0
    if (nextChatAt > Date.now()) {
      await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'pending', next_attempt_at: new Date(nextChatAt) },
        $unset: { lease_until: 1 }, $inc: { attempts: -1 } })
      continue
    }
    if (delivery.address_id) {
      const [address, user] = await Promise.all([
        Address.findById(delivery.address_id),
        User.findOne({ user_id: Number(delivery.user_id) }),
      ])
      if (!address || !user || address.is_deleted || !address.notifications?.is_enabled || user.is_blocked || user.is_deactivated) {
        await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'skipped' }, $unset: { lease_until: 1 } })
        continue
      }
    }
    try {
      state.chats.set(String(delivery.chat_id), Date.now() + (Number(delivery.chat_id) < 0 ? 3100 : 1100))
      const sendText = () => api.sendMessage(delivery.chat_id, delivery.text, {
        parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      })
      if (delivery.rich_html && typeof api.sendRichMessage === 'function') {
        try { await api.sendRichMessage(delivery.chat_id, { html: delivery.rich_html, skip_entity_detection: true }) }
        catch (error) {
          // Only an explicit rejection allows a second send without risking an
          // accepted rich message also being delivered as plain text.
          if ((error.error_code || error.error?.error_code) !== 400) throw error
          await sendText()
        }
      } else await sendText()
      await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'sent', sent_at: new Date() }, $unset: { lease_until: 1, last_error: 1 } })
      sent += 1
      if (delivery.address_id) {
        try { await Address.updateOne({ _id: delivery.address_id }, { $inc: { 'counters.send_coins': 1 } }) }
        catch (error) { console.error(`Could not update address counter: ${safeError(error)}`) }
      }
      await sleep(40)
      if (sent >= maxMessages) break
    } catch (error) {
      const code = error.error_code || error.error?.error_code
      if (code === 403 || code === 400) {
        if (delivery.user_id && (code === 403 || /chat not found|user is deactivated/i.test(error.description || ''))) {
          await User.updateOne({ user_id: Number(delivery.user_id) }, { $set: { is_blocked: true } })
        }
        await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'skipped', last_error: safeError(error).slice(0, 300) }, $unset: { lease_until: 1 } })
      } else {
        const retryAfter = error.parameters?.retry_after || error.error?.parameters?.retry_after
        const wait = retryAfter ? retryAfter * 1000 + 100 : Math.min(60000 * 2 ** Math.min(delivery.attempts || 1, 6), 3600000)
        await Delivery.updateOne({ _id: delivery._id }, { $set: {
          status: 'pending', next_attempt_at: new Date(Date.now() + wait),
          last_error: safeError(error).slice(0, 300),
        }, $unset: { lease_until: 1 } })
        console.error(`Delivery retry in ${Math.round(wait / 1000)}s: ${safeError(error)}`)
        if (code === 429) { state.cooldownUntil = Date.now() + wait; break }
      }
    }
  }
  return sent
}

async function main() {
  if (config.sendNotifications) requireBotToken()
  const signal = shutdownSignal()
  if (!await connectDatabase(signal, 'scanner')) return
  await Delivery.collection.createIndex({ status: 1, next_attempt_at: 1, created_at: 1 })
  await TraceTask.collection.createIndex({ status: 1, next_attempt_at: 1 })
  const client = new TonCenter()
  const state = {}
  console.log(`Scanner connected; Telegram delivery ${config.sendNotifications ? 'enabled' : 'disabled'}`)
  const workers = [workerLoop('scanner', async () => {
      await scanCycle(client, state)
      const lag = state.tip - state.lastProcessed
      return { seqno: state.lastProcessed, tip: state.tip, lag, catchingUp: lag > 0 }
    }, { signal, intervalMs: config.scanIntervalMs }),
    workerLoop('traces', () => reconcileTraces(client), { signal, intervalMs: 5000 })]
  if (config.sendNotifications) {
    const api = new Api(config.botToken, { timeoutSeconds: 30 })
    const deliveryState = {}
    workers.push(workerLoop('delivery', async () => ({ sent: await sendPending(api, deliveryState) }), { signal, intervalMs: 250 }))
  } else {
    await health('delivery', { status: 'disabled' })
  }
  await Promise.all(workers)
  await mongoose.disconnect()
}

if (require.main === module) main().catch((error) => { console.error(safeError(error)); process.exit(1) })

module.exports = { deliveryId, routeAction, routeEntries, scanBlock, scanCycle, reconcileTraces, sendPending, loadWatched, channelEligible, shouldSuppress, rawFallbacks }
