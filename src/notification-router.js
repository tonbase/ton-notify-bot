const { config } = require('./config')
const { Address, User, Delivery } = require('./models')
const { rawAddress } = require('./address')
const { participants, formatNotification } = require('./events')
const { passesFilters } = require('./notification-filter')
const { toNano, scaledInteger } = require('./amount')
const { USDT_MASTER, USDT_DECIMALS } = require('./assets')
const { isExcludedTransfer, resolveAccountLabel } = require('./address-book')
const { tonUsdPrice } = require('./prices')
const { deliveryId, deliveryOperation, enqueue } = require('./delivery-queue')
const { actionTime, digestWindow, digestId, isConfiguredHotAddress, isHighVolumeAddress, enqueueDigest, enqueueDigestBatch, saveDigestEvent } = require('./digest')

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
  if (!config.channelId || action.success === false) return false
  if (action.type === 'ton_transfer') {
    const minimum = toNano(config.minChannelTon)
    if (minimum === null) return false
    try { return BigInt(action.details?.value || '0') >= BigInt(minimum) }
    catch { return false }
  }
  if (action.type !== 'jetton_transfer' || action.success !== true
    || rawAddress(action.details?.asset) !== USDT_MASTER) return false
  const minimum = scaledInteger(config.minChannelUsdt, USDT_DECIMALS)
  const amount = scaledInteger(action.details?.amount)
  return minimum !== null && amount !== null && BigInt(amount) > BigInt(minimum)
}

async function routeAction(action, metadata, watched, excluded = new Set(), digestBatches, deliveryLane) {
  if (!action.action_id || typeof action.action_id !== 'string') throw new Error('Action without action_id')
  if (isExcludedTransfer(action)) return
  const label = (address, userId) => resolveAccountLabel(watched, address, userId)
  const matching = new Map()
  for (const participant of participants(action)) {
    if (excluded.has(participant)) continue
    for (const record of watched.map.get(participant) || []) matching.set(String(record._id), record)
  }
  const eligible = [...matching.values()].filter((record) => watched.active.has(record.user_id) && passesFilters(record, action))
  const detailed = []
  const digests = []
  const policy = new Map()
  for (const record of eligible) {
    const raw = rawAddress(record.address)
    if (isConfiguredHotAddress(raw) && actionTime(action) < config.hotDigestCutoverUtime) continue
    if (!policy.has(raw)) policy.set(raw, await isHighVolumeAddress(action, raw))
    if (policy.get(raw)) digests.push(record)
    else detailed.push(record)
  }
  // Snapshot once so private and channel recipients use the same cached rate.
  // Price I/O runs independently and never delays routing or queue durability.
  const tonUsdRate = tonUsdPrice.current()
  if (detailed.length > 1) {
    const existing = await Delivery.find({ _id: { $in: detailed.map((record) => deliveryId(action.action_id, String(record._id))) } })
      .select({ _id: 1 }).lean()
    const saved = new Set(existing.map((row) => row._id))
    const operations = detailed.filter((record) => !saved.has(deliveryId(action.action_id, String(record._id))))
      .map((record) => deliveryOperation(action, record.user_id, formatNotification(action, record.address, record, metadata, label, tonUsdRate), record, deliveryLane))
    if (operations.length) {
      try { await Delivery.bulkWrite(operations, { ordered: false }) }
      catch (error) {
        // Concurrent scans and replays can insert the same deterministic
        // IDs. Only duplicate-key races are safe to ignore; durability errors
        // must prevent the block cursor from advancing.
        if (!error.writeErrors?.length || error.writeErrors.some((item) => item.code !== 11000)
          || error.writeConcernErrors?.length || error.result?.getWriteConcernError?.()) throw error
      }
    }
  } else if (detailed.length) {
    const record = detailed[0]
    await enqueue(action, record.user_id, formatNotification(action, record.address, record, metadata, label, tonUsdRate), record, deliveryLane)
  }
  // The first events of a dynamic window may already have individual records.
  // Replay must not count those same actions again inside its digest.
  const dynamic = digests.filter((record) => !isConfiguredHotAddress(rawAddress(record.address)))
  const prior = dynamic.length ? await Delivery.find({ _id: { $in: dynamic.map((record) =>
    deliveryId(action.action_id, String(record._id))) } }).select({ _id: 1 }).lean() : []
  const individuallyQueued = new Set(prior.map((row) => row._id))
  const savedEvents = new Set()
  for (const record of digests) {
    if (individuallyQueued.has(deliveryId(action.action_id, String(record._id)))) continue
    const raw = rawAddress(record.address)
    if (!savedEvents.has(raw)) {
      await saveDigestEvent(action, raw, metadata, label)
      savedEvents.add(raw)
    }
    if (digestBatches) {
      const id = digestId(String(record._id), digestWindow(action).start)
      if (!digestBatches.has(id)) digestBatches.set(id, { record, actions: [] })
      digestBatches.get(id).actions.push(action)
    } else await enqueueDigest(action, record)
  }
  if (channelEligible(action)) {
    const source = action.details.source || action.details.sender || action.details.destination || action.details.receiver
    await enqueue(action, config.channelId, formatNotification(action, source, null, metadata, label, tonUsdRate), null, deliveryLane)
  }
}

async function routeEntries(entries, watched, sharedDigestBatches, deliveryLane) {
  const covered = new Map()
  const digestBatches = sharedDigestBatches || new Map()
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
    await routeAction(action, metadata, watched, excluded, digestBatches, deliveryLane)
  }
  if (!sharedDigestBatches) await flushDigestBatches(digestBatches)
}

async function flushDigestBatches(digestBatches) {
  // The scanner must await this before committing any covered block. Replay
  // retries partial writes using the same IDs and sets after a failed flush.
  for (const { record, actions } of digestBatches.values()) await enqueueDigestBatch(actions, record)
}

function shouldSuppress(action, significantTraces) {
  return ['call_contract', 'gasless_request', 'excess'].includes(action.type)
    && Boolean(action.trace_id) && significantTraces.has(action.trace_id)
}

module.exports = { loadWatched, channelEligible, routeAction, routeEntries, flushDigestBatches, shouldSuppress }
