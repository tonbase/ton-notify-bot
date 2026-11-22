const test = require('node:test')
const assert = require('node:assert/strict')
const { Delivery } = require('../src/models')
const { sendPendingParallel } = require('../src/delivery')
const { createTelegramSender } = require('../src/telegram-sender')

function fakeQueue(t, records) {
  const matches = (record, query) => {
    if (query.delivery_kind === 'digest' && record.delivery_kind !== 'digest') return false
    if (query.delivery_kind?.$ne === 'digest' && record.delivery_kind === 'digest') return false
    if (query['digest.window_start']?.$exists === false && record.digest?.window_start !== undefined) return false
    if (query['digest.window_start']?.$gte && !(record.digest?.window_start >= query['digest.window_start'].$gte)) return false
    if (query.delivery_lane && record.delivery_lane !== query.delivery_lane) return false
    if (typeof query.chat_id === 'number' && query.chat_id !== record.chat_id) return false
    if (query.chat_id?.$nin?.includes(record.chat_id)) return false
    if (query.status === 'pending' && record.status !== 'pending') return false
    if (query.status?.$in && !query.status.$in.includes(record.status)) return false
    if (record.next_attempt_at > query.next_attempt_at.$lte) return false
    if (query.next_attempt_at.$gte && record.next_attempt_at < query.next_attempt_at.$gte) return false
    if (query.$or && record.status !== 'pending' && !(record.lease_until <= query.$or[1].lease_until.$lte)) return false
    return true
  }
  t.mock.method(Delivery, 'find', query => ({ sort: () => ({ limit: limit => ({ select: () => ({
    lean: async () => records.filter(record => matches(record, query)).slice(0, limit),
  }) }) }) }))
  t.mock.method(Delivery, 'findOneAndUpdate', async (query, update) => {
    const record = records.find(record => matches(record, query))
    if (!record) return null
    Object.assign(record, update.$set)
    record.attempts += update.$inc.attempts
    return { ...record }
  })
  const updateRecords = async (query, update) => {
    for (const record of records.filter(item => query._id === item._id || query._id?.$in?.includes(item._id))) {
      Object.assign(record, update.$set)
      for (const key of Object.keys(update.$unset || {})) delete record[key]
      for (const [key, value] of Object.entries(update.$inc || {})) record[key] += value
    }
  }
  t.mock.method(Delivery, 'updateOne', updateRecords)
  t.mock.method(Delivery, 'updateMany', updateRecords)
}

function queued(id, fields = {}) {
  return { _id: id, chat_id: 123, text: id, status: 'pending', attempts: 0, next_attempt_at: new Date(0), ...fields }
}

test('live priority survives initial and batch claims ahead of historical work for the same chat', async t => {
  const records = [queued('history'), queued('live1', { delivery_lane: 'live', status: 'sending', lease_until: new Date(0) }),
    queued('live2', { delivery_lane: 'live' }), queued('digest', { delivery_kind: 'digest' })]
  fakeQueue(t, records)
  const texts = []
  await sendPendingParallel({ sendMessage: async (_chat, text) => texts.push(text) }, {},
    { maxMessages: 1, batchSize: 3, preferLive: true, digestNotBefore: new Date(900000) })
  assert.deepEqual(texts, ['live1\n\nlive2'])
  assert.equal(records[0].status, 'pending')
  assert.equal(records[3].attempts, 0)
})

test('only complete future windows are released while historical and malformed digests stay untouched', async t => {
  const records = [queued('old', { delivery_kind: 'digest', digest: { window_start: new Date(1) } }),
    queued('legacy', { digest: { window_start: new Date(1) } }), queued('malformed', { delivery_kind: 'digest' }),
    queued('future', { delivery_kind: 'digest', digest: { address: '0:' + '1'.repeat(64), window_start: new Date(900000), window_end: new Date(1800000) }, next_attempt_at: new Date(1920000) })]
  const before = JSON.stringify(records.slice(0, 3))
  fakeQueue(t, records)
  const texts = []
  await sendPendingParallel({ sendMessage: async (_chat, text) => texts.push(text) }, {},
    { maxMessages: 1, batchSize: 3, digestNotBefore: new Date(900000) })
  assert.equal(texts.length, 1)
  assert.equal(records[3].status, 'sent')
  assert.equal(JSON.stringify(records.slice(0, 3)), before)
})

test('catch-up sends ordinary batches and expired leases without claiming modern or legacy digests', async t => {
  const records = [queued('modern', { delivery_kind: 'digest' }),
    queued('legacy', { digest: { window_start: new Date(1) } }),
    queued('leased', { status: 'sending', lease_until: new Date(0) }), queued('second'),
    queued('active', { status: 'sending', lease_until: new Date(Date.now() + 600000) })]
  const before = JSON.stringify(records.slice(0, 2))
  fakeQueue(t, records)
  const texts = []
  assert.equal(await sendPendingParallel({ sendMessage: async (_chat, text) => texts.push(text) }, {},
    { maxMessages: 1, batchSize: 3, excludeDigests: true }), 1)
  assert.deepEqual(texts, ['leased\n\nsecond'])
  assert.equal(JSON.stringify(records.slice(0, 2)), before)
  assert.equal(records[2].status, 'sent')
  assert.equal(records[3].status, 'sent')
  assert.equal(records[4].attempts, 0)
})

test('normal delivery selection resumes digest priority after catch-up', async t => {
  const records = [queued('event'), queued('digest', { delivery_kind: 'digest' })]
  fakeQueue(t, records)
  const texts = []
  await sendPendingParallel({ sendMessage: async (_chat, text) => texts.push(text) }, {}, { maxMessages: 1 })
  assert.deepEqual(texts, ['digest'])
  assert.equal(records[0].status, 'pending')
})

test('loss of live freshness between rounds prevents further digest claims', async t => {
  const records = [queued('first', { delivery_kind: 'digest' }), queued('second', { delivery_kind: 'digest', chat_id: 456 })]
  fakeQueue(t, records)
  let fresh = true
  const texts = []
  await sendPendingParallel({ sendMessage: async (_chat, text) => { texts.push(text); fresh = false } }, {},
    { maxMessages: 2, concurrency: 1, getDeliveryPolicy: () => ({ excludeDigests: !fresh }) })
  assert.deepEqual(texts, ['first'])
  assert.equal(records[1].status, 'pending')
  assert.equal(records[1].attempts, 0)
})

test('a digest is released if freshness is lost during its final database preparation', async t => {
  const records = [queued('digest', { delivery_kind: 'digest', digest: {
    address: '0:' + '1'.repeat(64), window_start: new Date(900000), window_end: new Date(1800000),
  } })]
  fakeQueue(t, records)
  let fresh = true
  const update = Delivery.updateOne
  t.mock.method(Delivery, 'updateOne', async (...args) => {
    if (args[1].$set?.text !== undefined) fresh = false
    return update(...args)
  })
  let sent = 0
  await sendPendingParallel({ sendMessage: async () => { sent++ } }, {},
    { maxMessages: 1, getDeliveryPolicy: () => ({ excludeDigests: !fresh }) })
  assert.equal(sent, 0)
  assert.equal(records[0].status, 'pending')
  assert.equal(records[0].attempts, 0)
})

test('a digest waiting inside the Telegram limiter rechecks freshness before the network request', async t => {
  const records = [queued('digest', { delivery_kind: 'digest', digest: {
    address: '0:' + '1'.repeat(64), window_start: new Date(900000), window_end: new Date(1800000),
  } })]
  fakeQueue(t, records)
  let fresh = true
  let sent = 0
  const state = {}
  const sender = createTelegramSender({ sendMessage: async () => { sent++ } }, state,
    { limiter: { run: async fn => { fresh = false; return fn() } } })
  await sendPendingParallel(sender, state,
    { maxMessages: 1, getDeliveryPolicy: () => ({ excludeDigests: !fresh }) })
  assert.equal(sent, 0)
  assert.equal(records[0].status, 'pending')
  assert.equal(records[0].attempts, 0)
})

test('catch-up preserves event retries and digest state during Telegram cooldown', async t => {
  const records = [queued('digest', { delivery_kind: 'digest' }), queued('event')]
  const before = JSON.stringify(records[0])
  fakeQueue(t, records)
  t.mock.method(console, 'error', () => {})
  const state = {}
  const api = { sendMessage: async () => { throw { error_code: 429, parameters: { retry_after: 30 } } } }
  assert.equal(await sendPendingParallel(api, state, { maxMessages: 1, excludeDigests: true }), 0)
  assert.equal(records[1].status, 'pending')
  assert(records[1].next_attempt_at > new Date(Date.now() + 29000))
  assert.equal(JSON.stringify(records[0]), before)
  assert.equal(await sendPendingParallel(api, state, { maxMessages: 1, excludeDigests: true }), 0)
})

test('shutdown commits an accepted message and starts no further delivery rounds', async t => {
  const records = [queued('first'), queued('second', { chat_id: 456 })]
  fakeQueue(t, records)
  const controller = new AbortController()
  let sent = 0
  await sendPendingParallel({ sendMessage: async () => { sent++; controller.abort() } }, {},
    { maxMessages: 5, concurrency: 1, signal: controller.signal })
  assert.equal(sent, 1)
  assert.equal(records[0].status, 'sent')
  assert.equal(records[1].status, 'pending')
  assert.equal(records[1].attempts, 0)
})
