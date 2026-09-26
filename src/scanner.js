const crypto = require('node:crypto')
const { Api } = require('grammy')
const { config, requireBotToken } = require('./config')
const { mongoose, Address, User, Counter, Delivery } = require('./models')
const { rawAddress } = require('./address')
const { participants, formatAction, passesFilters } = require('./events')
const { toNano } = require('./amount')
const { TonCenter, sleep } = require('./toncenter')

const CURSOR_NAME = 'actions_scan_v1'

function deliveryId(actionId, recipient) {
  return crypto.createHash('sha256').update(`${actionId}|${recipient}`).digest('hex')
}

async function enqueue(action, recipient, text, record) {
  const id = deliveryId(action.action_id, record ? String(record._id) : `channel:${recipient}`)
  try {
    await Delivery.updateOne({ _id: id }, { $setOnInsert: {
      _id: id, status: 'pending', attempts: 0, chat_id: recipient,
      user_id: record ? String(record.user_id) : '',
      address_id: record ? String(record._id) : '',
      action_id: action.action_id, text, created_at: new Date(), next_attempt_at: new Date(0),
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

async function routeAction(action, metadata, watched) {
  if (!action.action_id || typeof action.action_id !== 'string') throw new Error('Action without action_id')
  const matching = new Map()
  for (const participant of participants(action)) {
    for (const record of watched.map.get(participant) || []) matching.set(String(record._id), record)
  }
  for (const record of matching.values()) {
    if (!watched.active.has(record.user_id) || !passesFilters(record, action)) continue
    await enqueue(action, record.user_id, formatAction(action, record.address, record, metadata), record)
  }
  if (channelEligible(action)) {
    await enqueue(action, config.channelId, formatAction(action, action.details.source || action.details.destination, null, metadata), null)
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
  const significantTraces = new Set(entries.filter(({ action }) => !['call_contract', 'gasless_request', 'excess'].includes(action.type))
    .map(({ action }) => action.trace_id).filter(Boolean))
  for (const { action, metadata } of entries) {
    if (shouldSuppress(action, significantTraces)) continue
    await routeAction(action, metadata, watched)
  }
  offset = 0
  const transactions = []
  for (;;) {
    const page = await client.transactionsByMasterchainBlock({ seqno, limit: config.pageSize, offset, sort: 'asc' })
    transactions.push(...page.transactions)
    if (page.transactions.length < config.pageSize) break
    offset += page.transactions.length
    if (offset > 1000000) throw new Error(`Block ${seqno} exceeded transaction safety limit`)
  }
  const fallback = rawFallbacks(transactions, entries.map(({ action }) => action))
  for (const action of fallback) await routeAction(action, {}, watched)
  return entries.length + fallback.length
}

function shouldSuppress(action, significantTraces) {
  return ['call_contract', 'gasless_request', 'excess'].includes(action.type)
    && Boolean(action.trace_id) && significantTraces.has(action.trace_id)
}

function rawFallbacks(transactions, actions) {
  const coveredTransactions = new Set(actions.flatMap((action) => action.transactions || []))
  const coveredTraces = new Set(actions.map((action) => action.trace_id).filter(Boolean))
  const coveredMessages = new Set(transactions.filter((tx) => coveredTransactions.has(tx.hash))
    .flatMap((tx) => [tx.in_msg, ...(tx.out_msgs || [])]).map((message) => message?.hash).filter(Boolean))
  const seenMessages = new Set()
  const fallback = []
  for (const tx of transactions) {
    if (coveredTransactions.has(tx.hash) || (tx.trace_id && coveredTraces.has(tx.trace_id))) continue
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
  const watched = await loadWatched()
  for (let block = seqno + 1; block <= Math.min(tip, seqno + 10); block += 1) {
    const count = await scanBlock(client, block, watched)
    await Counter.updateOne({ name: CURSOR_NAME }, { $max: { 'data.seqno': block } })
    state.lastProcessed = block
    if (count) console.log(`Indexed block ${block}: ${count} actions`)
  }
  const lastProcessed = state.lastProcessed || seqno
  if (config.replayBlocks > 0 && lastProcessed > 0 && tip - lastProcessed <= config.replayBlocks * 2) {
    if (state.replayWindowEnd === undefined || state.replayOffset >= config.replayBlocks) {
      state.replayWindowEnd = lastProcessed
      state.replayOffset = 0
    }
    const replay = Math.max(1, state.replayWindowEnd - state.replayOffset)
    const count = await scanBlock(client, replay, watched)
    state.replayOffset += 1
    if (count) console.log(`Replayed block ${replay}: ${count} actions`)
  }
  return state
}

async function sendPending(api) {
  let sent = 0
  while (sent < 100) {
    const now = new Date()
    const delivery = await Delivery.findOneAndUpdate({
      status: { $in: ['pending', 'sending'] },
      next_attempt_at: { $lte: now },
      $or: [{ status: 'pending' }, { lease_until: { $lte: now } }],
    }, { $set: { status: 'sending', lease_until: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } },
    { sort: { created_at: 1 }, new: true })
    if (!delivery) break
    if (delivery.address_id) {
      const [address, user] = await Promise.all([
        Address.findById(delivery.address_id),
        User.findOne({ user_id: Number(delivery.user_id) }),
      ])
      if (!address || address.is_deleted || !address.notifications?.is_enabled || user?.is_blocked || user?.is_deactivated) {
        await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'skipped' }, $unset: { lease_until: 1 } })
        continue
      }
    }
    try {
      await api.sendMessage(delivery.chat_id, delivery.text, {
        parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      })
      await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'sent', sent_at: new Date() }, $unset: { lease_until: 1, last_error: 1 } })
      sent += 1
      if (delivery.address_id) {
        try { await Address.updateOne({ _id: delivery.address_id }, { $inc: { 'counters.send_coins': 1 } }) }
        catch (error) { console.error(`Could not update address counter ${delivery.address_id}: ${error.message}`) }
      }
      await sleep(40)
    } catch (error) {
      const code = error.error_code || error.error?.error_code
      if (code === 403 || code === 400) {
        if (delivery.user_id && (code === 403 || /chat not found|user is deactivated/i.test(error.description || ''))) {
          await User.updateOne({ user_id: Number(delivery.user_id) }, { $set: { is_blocked: true } })
        }
        await Delivery.updateOne({ _id: delivery._id }, { $set: { status: 'skipped', last_error: String(error.description || error.message).slice(0, 300) }, $unset: { lease_until: 1 } })
      } else {
        const retryAfter = error.parameters?.retry_after || error.error?.parameters?.retry_after
        const wait = retryAfter ? retryAfter * 1000 : Math.min(60000 * 2 ** Math.min(delivery.attempts, 6), 3600000)
        await Delivery.updateOne({ _id: delivery._id }, { $set: {
          status: 'pending', next_attempt_at: new Date(Date.now() + wait),
          last_error: String(error.description || error.message).slice(0, 300),
        }, $unset: { lease_until: 1 } })
        console.error(`Delivery ${delivery._id} retry in ${Math.round(wait / 1000)}s: ${error.message}`)
        if (code === 429) break
      }
    }
  }
  return sent
}

async function main() {
  requireBotToken()
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000, autoIndex: false })
  await Delivery.collection.createIndex({ status: 1, next_attempt_at: 1, created_at: 1 })
  const client = new TonCenter()
  const api = new Api(config.botToken)
  const state = {}
  let stopping = false
  process.once('SIGINT', () => { stopping = true })
  process.once('SIGTERM', () => { stopping = true })
  console.log('Scanner connected to MongoDB')
  while (!stopping) {
    try {
      await scanCycle(client, state)
      await sendPending(api)
    } catch (error) {
      console.error('Scanner cycle failed; cursor preserved:', error)
    }
    if (!stopping) await sleep(config.scanIntervalMs)
  }
  await mongoose.disconnect()
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { deliveryId, routeAction, scanBlock, scanCycle, sendPending, loadWatched, channelEligible, shouldSuppress, rawFallbacks }
