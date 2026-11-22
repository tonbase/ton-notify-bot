const crypto = require('node:crypto')
const { Delivery } = require('./models')
const { filterAction } = require('./notification-filter')

function deliveryId(actionId, recipient) {
  return crypto.createHash('sha256').update(`${actionId}|${recipient}`).digest('hex')
}

function deliveryOperation(action, recipient, notification, record, deliveryLane) {
  const id = deliveryId(action.action_id, record ? String(record._id) : `channel:${recipient}`)
  return { updateOne: { filter: { _id: id }, update: { $setOnInsert: {
      _id: id, status: 'pending', attempts: 0, chat_id: recipient,
      ...(deliveryLane ? { delivery_lane: deliveryLane } : {}),
      chat_type: record ? 'private' : 'channel',
      user_id: record ? String(record.user_id) : '',
      address_id: record ? String(record._id) : '',
      action_id: action.action_id, text: notification.text, rich_html: notification.richHtml,
      filter_action: filterAction(action),
      created_at: new Date(), next_attempt_at: new Date(0),
    } }, upsert: true } }
}

async function enqueue(action, recipient, notification, record, deliveryLane) {
  const { filter, update, upsert } = deliveryOperation(action, recipient, notification, record, deliveryLane).updateOne
  try {
    await Delivery.updateOne(filter, update, { upsert })
  } catch (error) {
    if (error.code !== 11000) throw error
  }
}

const LEASE_MS = 120000

function readyQuery(now = new Date(), { chatId, excludedChats = [], pendingOnly = false, deliveryKind,
  excludeDigests = false, digestNotBefore, deliveryLane } = {}) {
  const eventsOnly = excludeDigests || (digestNotBefore && deliveryKind !== 'digest')
  return {
    ...(chatId === undefined ? {} : { chat_id: chatId }),
    ...(deliveryKind ? { delivery_kind: deliveryKind } : {}),
    ...(deliveryLane ? { delivery_lane: deliveryLane } : {}),
    ...(eventsOnly ? { delivery_kind: { $ne: 'digest' }, 'digest.window_start': { $exists: false } }
      : digestNotBefore ? { 'digest.window_start': { $gte: digestNotBefore } } : {}),
    status: pendingOnly ? 'pending' : { $in: ['pending', 'sending'] },
    next_attempt_at: { $lte: now },
    ...(!pendingOnly ? { $or: [{ status: 'pending' }, { lease_until: { $lte: now } }] } : {}),
    ...(excludedChats.length ? { chat_id: { $nin: excludedChats } } : {}),
  }
}

function claimDelivery(options) {
  return Delivery.findOneAndUpdate(readyQuery(new Date(), options), {
    $set: { status: 'sending', lease_until: new Date(Date.now() + LEASE_MS) },
    $inc: { attempts: 1 },
  }, { sort: { created_at: 1 }, new: true })
}

function updateBatch(batch, update) {
  return batch.length === 1
    ? Delivery.updateOne({ _id: batch[0]._id }, update)
    : Delivery.updateMany({ _id: { $in: batch.map((item) => item._id) } }, update)
}

function releaseBatch(batch, until = Date.now()) {
  return updateBatch(batch, {
    $set: { status: 'pending', next_attempt_at: new Date(until) },
    $unset: { lease_until: 1 },
    $inc: { attempts: -1 },
  })
}

async function ensureDeliveryIndexes({ liveRecovery = false } = {}) {
  await Delivery.collection.createIndex({ status: 1, next_attempt_at: 1, created_at: 1 })
  await Delivery.collection.createIndex({ status: 1, created_at: 1, next_attempt_at: 1 })
  await Delivery.collection.createIndex({ chat_id: 1, status: 1, created_at: 1 })
  await Delivery.collection.createIndex({ status: 1, sent_at: -1 })
  await Delivery.collection.createIndex({ delivery_kind: 1, status: 1, next_attempt_at: 1 })
  if (liveRecovery) await Delivery.collection.createIndex({ delivery_lane: 1, status: 1, created_at: 1, next_attempt_at: 1 },
    { name: 'live_delivery_ready_v1', partialFilterExpression: { delivery_lane: 'live' } })
}

module.exports = {
  deliveryId, deliveryOperation, enqueue, readyQuery, claimDelivery,
  updateBatch, releaseBatch, ensureDeliveryIndexes,
}
