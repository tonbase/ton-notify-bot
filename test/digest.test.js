const test = require('node:test')
const assert = require('node:assert/strict')

const HOT = `0:${'A'.repeat(64)}`
const OTHER = `0:${'B'.repeat(64)}`
process.env.HOT_DIGEST_ADDRESSES = HOT
process.env.HOT_DIGEST_CUTOVER_UTIME = '900'
const { config } = require('../src/config')
const { DigestWindow, DigestEvent, Delivery, Address, User } = require('../src/models')
const { digestWindow, digestId, formatDigest } = require('../src/digest')
const { routeAction } = require('../src/notification-router')
const { sendPending, sendPendingParallel } = require('../src/delivery')

function action(id, utime = 1000) {
  return { action_id: id, start_utime: utime, type: 'ton_transfer', success: true,
    details: { source: HOT, destination: OTHER, value: '1000000000' } }
}

test('15-minute buckets and digest IDs are stable across replay', () => {
  assert.deepEqual(digestWindow(action('one', 1000)), { start: 900000, end: 1800000 })
  assert.equal(digestId('subscription', 900000), digestId('subscription', 900000))
  assert.notEqual(digestId('subscription', 900000), digestId('subscription', 1800000))
})

test('configured high-volume address creates one durable summary and deduplicates replays', async (t) => {
  t.mock.method(DigestEvent, 'updateOne', async () => {})
  const subscription = { _id: 'subscription', user_id: 123, address: HOT,
    notifications: { is_enabled: true, min_amount: '0' } }
  const watched = { map: new Map([[HOT, [subscription]]]), active: new Set([123]) }
  const buckets = new Map(), deliveries = new Map()
  t.mock.method(DigestWindow, 'findOneAndUpdate', async (filter, update) => {
    const ids = buckets.get(filter._id) || []
    if (!ids.includes(update.$addToSet.action_ids)) ids.push(update.$addToSet.action_ids)
    buckets.set(filter._id, ids)
    return { action_ids: ids }
  })
  t.mock.method(Delivery, 'updateOne', async (filter, update) => {
    const existing = deliveries.get(filter._id) || { ...update.$setOnInsert, digest_count: 0 }
    existing.digest_count = Math.max(existing.digest_count, update.$max.digest_count)
    deliveries.set(filter._id, existing)
  })
  await routeAction(action('old', 899), {}, watched)
  assert.equal(deliveries.size, 0)
  await routeAction(action('one'), {}, watched)
  await routeAction(action('one'), {}, watched)
  await routeAction(action('two'), {}, watched)
  assert.equal(deliveries.size, 1)
  const summary = [...deliveries.values()][0]
  assert.equal(summary.digest_count, 2)
  assert.equal(summary.chat_id, 123)
  assert.equal(summary.next_attempt_at.toISOString(), '1970-01-01T00:32:00.000Z')
  assert.equal(summary.status, 'pending')
})

test('summary delivery sends the count once and keeps ordinary events out of its batch', async (t) => {
  const digest = { _id: 'digest', chat_id: 123, address_id: 'subscription', user_id: '123',
    digest_count: 42, digest: { address: HOT,
      window_start: new Date('2026-09-27T12:00:00Z'), window_end: new Date('2026-09-27T12:15:00Z') } }
  let claims = 0, sent = 0
  t.mock.method(Delivery, 'findOneAndUpdate', async () => claims++ ? null : digest)
  t.mock.method(Delivery, 'updateOne', async () => {})
  t.mock.method(Address, 'findById', async () => ({ notifications: { is_enabled: true } }))
  t.mock.method(User, 'findOne', async () => ({ is_blocked: false, is_deactivated: false }))
  const count = await sendPending({ sendMessage: async (_chat, text) => {
    sent++
    assert.match(text, /42 events/)
    assert.match(text, /12:00–12:15 UTC/)
  } }, {}, { maxMessages: 1, batchSize: 10 })
  assert.equal(count, 1)
  assert.equal(sent, 1)
  assert.equal(claims, 1)
  assert.match(formatDigest(digest), /tonscan\.org/)
})

test('threshold activates summaries for a newly busy address', async (t) => {
  const { isHighVolumeAddress } = require('../src/digest')
  config.digestThresholdPerWindow = 2
  const buckets = new Map()
  t.mock.method(DigestWindow, 'findOneAndUpdate', async (filter, update) => {
    const ids = buckets.get(filter._id) || []
    if (!ids.includes(update.$addToSet.action_ids)) ids.push(update.$addToSet.action_ids)
    buckets.set(filter._id, ids)
    return { action_ids: ids }
  })
  t.mock.method(DigestWindow, 'findById', () => ({ select: () => ({ lean: async () => null }) }))
  assert.equal(await isHighVolumeAddress(action('one'), OTHER), false)
  assert.equal(await isHighVolumeAddress(action('two'), OTHER), false)
  assert.equal(await isHighVolumeAddress(action('three'), OTHER), true)
  assert.equal(await isHighVolumeAddress(action('three'), OTHER), true)
  config.digestThresholdPerWindow = 0
})

test('due summaries take priority over an older per-event backlog', async (t) => {
  const selection = []
  const digest = { _id: 'digest-priority', chat_id: 123, address_id: 'subscription', user_id: '123',
    digest_count: 9, digest: { address: HOT,
      window_start: new Date('2026-09-27T12:00:00Z'), window_end: new Date('2026-09-27T12:15:00Z') } }
  t.mock.method(Delivery, 'find', (query) => ({ sort: () => ({ limit: () => ({ select: () => ({
    lean: async () => query.delivery_kind === 'digest' ? [{ chat_id: 123 }] : [{ chat_id: 123 }, { chat_id: 456 }],
  }) }) }) }))
  t.mock.method(Delivery, 'findOneAndUpdate', async (query) => {
    selection.push({ chat: query.chat_id, kind: query.delivery_kind })
    return query.delivery_kind === 'digest' ? digest : { _id: 'ordinary', chat_id: query.chat_id, text: 'event' }
  })
  t.mock.method(Delivery, 'updateOne', async () => {})
  t.mock.method(Address, 'findById', async () => ({ notifications: { is_enabled: true } }))
  t.mock.method(Address, 'updateOne', async () => {})
  t.mock.method(User, 'findOne', async () => ({ is_blocked: false, is_deactivated: false }))
  const sent = []
  assert.equal(await sendPendingParallel({ sendMessage: async (chat) => sent.push(chat) }, {},
    { maxMessages: 2, concurrency: 2 }), 2)
  assert.deepEqual(selection, [{ chat: 123, kind: 'digest' }, { chat: 456, kind: undefined }])
  assert.deepEqual(sent.sort(), [123, 456])
})
