const crypto = require('node:crypto')
const { config } = require('./config')
const { DigestWindow, DigestEvent, Delivery, Address } = require('./models')
const { rawAddress, friendlyAddress, shortAddress } = require('./address')
const { escapeHtml } = require('./events')
const { snapshotEvent, renderSummary, summaryKeyboard } = require('./digest-format')

const WINDOW_MS = 15 * 60 * 1000
const DIGEST_DELAY_MS = 2 * 60 * 1000
const WINDOW_RETENTION_SECONDS = 7 * 24 * 60 * 60
const configuredHot = new Set(config.hotDigestAddresses.map((address) => {
  const raw = rawAddress(address)
  if (!raw) throw new Error(`Invalid HOT_DIGEST_ADDRESSES entry: ${address}`)
  return raw
}))

function actionTime(action) {
  for (const candidate of [action.start_utime, action.end_utime, action.trace_end_utime]) {
    if (Number.isSafeInteger(candidate) && candidate > 0) return candidate
  }
  throw new Error('Action without a stable event timestamp cannot enter a digest')
}

function digestWindow(action) {
  const start = Math.floor(actionTime(action) * 1000 / WINDOW_MS) * WINDOW_MS
  return { start, end: start + WINDOW_MS }
}

function digestId(addressId, start) {
  return crypto.createHash('sha256').update(`digest|${addressId}|${start}`).digest('hex')
}

function digestEventId(address, actionId) {
  return crypto.createHash('sha256').update(`digest-event|${rawAddress(address)}|${actionId}`).digest('hex')
}

async function saveDigestEvent(action, address, metadata, resolveLabel) {
  const id = digestEventId(address, action.action_id)
  try {
    await DigestEvent.updateOne({ _id: id }, { $setOnInsert: {
      _id: id, ...snapshotEvent(action, address, metadata, resolveLabel, actionTime(action)), created_at: new Date(),
    } }, { upsert: true })
  } catch (error) { if (error.code !== 11000) throw error }
}

function isConfiguredHotAddress(raw) {
  return configuredHot.has(raw)
}

async function addUniqueAction(id, actionId) {
  const window = await DigestWindow.findOneAndUpdate({ _id: id }, {
    $setOnInsert: { created_at: new Date() },
    $addToSet: { action_ids: actionId },
  }, { upsert: true, new: true, lean: true })
  return window.action_ids.length
}

async function isHighVolumeAddress(action, raw, { threshold = config.digestThresholdPerWindow } = {}) {
  if (isConfiguredHotAddress(raw)) return true
  if (!threshold) return false
  const { start } = digestWindow(action)
  const current = await addUniqueAction(`volume:${raw}:${start}`, action.action_id)
  if (current > threshold) return true
  const previous = await DigestWindow.findById(`volume:${raw}:${start - WINDOW_MS}`)
    .select({ action_ids: 1 }).lean()
  return (previous?.action_ids?.length || 0) > threshold
}

async function enqueueDigest(action, record) {
  const { start, end } = digestWindow(action)
  const subscriptionId = String(record._id)
  const count = await addUniqueAction(`recipient:${subscriptionId}:${start}`, action.action_id)
  return saveDigestDelivery(record, start, end, count)
}

async function enqueueDigestBatch(actions, record) {
  if (actions.length === 1) return enqueueDigest(actions[0], record)
  if (!actions.length) throw new Error('Empty digest batch')
  const { start, end } = digestWindow(actions[0])
  if (actions.some(action => digestWindow(action).start !== start)) throw new Error('Mixed digest windows')
  const window = await DigestWindow.findOneAndUpdate({ _id: `recipient:${String(record._id)}:${start}` }, {
    $setOnInsert: { created_at: new Date() },
    $addToSet: { action_ids: { $each: actions.map(action => action.action_id) } },
  }, { upsert: true, new: true, lean: true })
  return saveDigestDelivery(record, start, end, window.action_ids.length)
}

async function saveDigestDelivery(record, start, end, count) {
  const subscriptionId = String(record._id)
  const id = digestId(subscriptionId, start)
  await Delivery.updateOne({ _id: id }, {
    $setOnInsert: {
      _id: id, status: 'pending', delivery_kind: 'digest', attempts: 0, chat_id: record.user_id,
      chat_type: 'private', user_id: String(record.user_id), address_id: subscriptionId,
      text: '', created_at: new Date(), next_attempt_at: new Date(end + DIGEST_DELAY_MS),
      digest: { address: record.address, window_start: new Date(start), window_end: new Date(end), format_version: 2 },
    },
    $max: { digest_count: count },
  }, { upsert: true })
  return { id, count }
}

function formatDigest(delivery, contents) {
  if (contents?.complete) return renderSummary(delivery, contents)
  const count = delivery.digest_count || 0
  const address = friendlyAddress(delivery.digest.address)
  const label = escapeHtml(shortAddress(delivery.digest.address))
  const start = new Date(delivery.digest.window_start).toISOString().slice(11, 16)
  const end = new Date(delivery.digest.window_end).toISOString().slice(11, 16)
  const url = `https://tonscan.org/address/${encodeURIComponent(address)}`
  return `📊 <b>${count} events</b> · ${start}–${end} UTC\n<a href="${url}">${label}</a> · 15-minute activity summary`
}

async function loadDigestContents(delivery) {
  if (delivery.digest?.format_version !== 2) return { complete: false }
  const window = await DigestWindow.findById(`recipient:${delivery.address_id}:${+new Date(delivery.digest.window_start)}`)
    .select({ action_ids: 1 }).lean()
  if (!window?.action_ids?.length) return { complete: false }
  const events = await DigestEvent.find({ _id: { $in: window.action_ids.map((id) => digestEventId(delivery.digest.address, id)) } }).lean()
  if (events.length !== window.action_ids.length) return { complete: false }
  const records = await Address.find({ user_id: Number(delivery.user_id), is_deleted: false })
    .select({ address: 1, tag: 1 }).lean()
  const labels = new Map(records.filter((record) => record.tag).map((record) => [rawAddress(record.address), record.tag]))
  return { complete: true, events, labels, tag: labels.get(rawAddress(delivery.digest.address)) }
}

async function prepareDigest(delivery) {
  const contents = await loadDigestContents(delivery)
  return { text: formatDigest(delivery, contents), reply_markup: summaryKeyboard(delivery, contents.complete) }
}

async function ensureDigestIndexes() {
  await DigestWindow.collection.createIndex({ created_at: 1 }, { expireAfterSeconds: WINDOW_RETENTION_SECONDS })
  await DigestEvent.collection.createIndex({ created_at: 1 }, { expireAfterSeconds: WINDOW_RETENTION_SECONDS })
}

module.exports = {
  WINDOW_MS, DIGEST_DELAY_MS, actionTime, digestWindow, digestId, digestEventId, saveDigestEvent,
  isConfiguredHotAddress, isHighVolumeAddress, enqueueDigest, enqueueDigestBatch, formatDigest, loadDigestContents, prepareDigest, ensureDigestIndexes,
}
