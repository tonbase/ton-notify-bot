const test = require('node:test')
const assert = require('node:assert/strict')
const HOT = `0:${'A'.repeat(64)}`
const OTHER = `0:${'B'.repeat(64)}`
process.env.HOT_DIGEST_ADDRESSES = HOT
process.env.HOT_DIGEST_CUTOVER_UTIME = '0'
const { DigestWindow, DigestEvent, Delivery, Address, User, Counter } = require('../src/models')
const { routeEntries } = require('../src/notification-router')
const { enqueueDigestBatch } = require('../src/digest')
const { scanCycle } = require('../src/block-scanner')
const { config } = require('../src/config')

const action = (id, time = 1000) => ({ action_id: id, start_utime: time, type: 'ton_transfer', success: true,
  details: { source: HOT, destination: OTHER, value: '1000000000' } })
const record = id => ({ _id: id, user_id: 123, address: HOT, notifications: { is_enabled: true, min_amount: '0' } })

function storage(t) {
  const windows = new Map(), deliveries = new Map(), events = new Set()
  let windowWrites = 0, deliveryWrites = 0
  t.mock.method(DigestEvent, 'updateOne', async query => events.add(query._id))
  t.mock.method(DigestWindow, 'findOneAndUpdate', async (query, update) => {
    windowWrites++
    const ids = windows.get(query._id) || new Set()
    const value = update.$addToSet.action_ids
    for (const id of value.$each || [value]) ids.add(id)
    windows.set(query._id, ids)
    return { action_ids: [...ids] }
  })
  t.mock.method(Delivery, 'updateOne', async (query, update) => {
    deliveryWrites++
    const row = deliveries.get(query._id) || { ...update.$setOnInsert, digest_count: 0 }
    if (update.$max) row.digest_count = Math.max(row.digest_count, update.$max.digest_count)
    deliveries.set(query._id, row)
  })
  t.mock.method(Delivery, 'find', query => ({ select: () => ({ lean: async () =>
    [...deliveries.values()].filter(row => query._id.$in.includes(row._id)) }) }))
  return { windows, deliveries, events, writes: () => ({ windowWrites, deliveryWrites }) }
}

test('block digest batches retain every action and separate recipient/window boundaries on replay', async t => {
  const db = storage(t)
  const watched = { map: new Map([[HOT, [record('a'), record('b')]]]), active: new Set([123]) }
  const entries = [action('one'), action('two'), action('one'), action('later', 1900)].map(action => ({ action, metadata: {} }))
  await routeEntries(entries, watched)
  assert.deepEqual(db.writes(), { windowWrites: 4, deliveryWrites: 4 })
  assert.equal(db.events.size, 3)
  assert.deepEqual([...db.deliveries.values()].map(row => row.digest_count).sort(), [1, 1, 2, 2])
  await routeEntries(entries, watched)
  assert.equal(db.deliveries.size, 4)
  assert.deepEqual([...db.deliveries.values()].map(row => row.digest_count).sort(), [1, 1, 2, 2])
  assert([...db.windows.values()].every(ids => ids.size <= 2))
})

test('failed digest delivery upsert prevents cursor commit and replay repairs the partial batch', async t => {
  const db = storage(t)
  const commits = []
  t.mock.method(Address, 'find', () => ({ lean: async () => [record('a'), record('b')] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [{ user_id: 123 }] }))
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: 41 } }) }))
  t.mock.method(Counter, 'updateOne', async (_query, update) => commits.push(update.$max['data.seqno']))
  const save = Delivery.updateOne
  let fail = true
  t.mock.method(Delivery, 'updateOne', async (...args) => { if (fail && args[1].$setOnInsert.address_id === 'b') throw new Error('DB unavailable'); return save(...args) })
  const client = { masterchainInfo: async () => ({ last: { seqno: 42 + config.lagBlocks } }),
    actions: async () => ({ actions: [action('one'), action('two')], metadata: {} }) }
  await assert.rejects(scanCycle(client), /DB unavailable/)
  assert.deepEqual(commits, [])
  assert.equal(db.deliveries.size, 1)
  assert.equal([...db.windows.values()][0].size, 2)
  fail = false
  await scanCycle(client)
  assert.deepEqual(commits, [42])
  assert.equal([...db.deliveries.values()][0].digest_count, 2)
  assert.equal(db.deliveries.size, 2)
  assert.equal(db.events.size, 2)
})

test('concurrent overlapping digest batches retain a monotonic count and the full unique set', async t => {
  const db = storage(t)
  await Promise.all([enqueueDigestBatch([action('a'), action('b')], record('one')),
    enqueueDigestBatch([action('b'), action('c')], record('one'))])
  assert.deepEqual([...db.windows.values()][0], new Set(['a', 'b', 'c']))
  assert.equal([...db.deliveries.values()][0].digest_count, 3)
})

test('a batch spanning different digest windows is rejected before database writes', async t => {
  const db = storage(t)
  await assert.rejects(enqueueDigestBatch([action('a'), action('b', 1900)], record('one')), /Mixed/)
  assert.deepEqual(db.writes(), { windowWrites: 0, deliveryWrites: 0 })
})

test('dynamic threshold transition and replay exclude events already individually queued', async t => {
  const previous = config.digestThresholdPerWindow
  config.digestThresholdPerWindow = 1
  t.after(() => { config.digestThresholdPerWindow = previous })
  const db = storage(t)
  t.mock.method(DigestWindow, 'findById', () => ({ select: () => ({ lean: async () => null }) }))
  const subscription = { ...record('dynamic'), address: OTHER }
  const watched = { map: new Map([[OTHER, [subscription]]]), active: new Set([123]) }
  const entries = ['one', 'two', 'three'].map(id => ({ action: action(id), metadata: {} }))
  await routeEntries(entries, watched)
  await routeEntries(entries, watched)
  assert.equal(db.deliveries.size, 2)
  const digest = [...db.deliveries.values()].find(row => row.delivery_kind === 'digest')
  assert.equal(digest.digest_count, 2)
  assert.deepEqual([...db.windows.entries()].find(([id]) => id.startsWith('recipient:'))[1], new Set(['two', 'three']))
})

test('later batches preserve previous IDs and do not reset sent status or attempts', async t => {
  const db = storage(t)
  await enqueueDigestBatch([action('a'), action('b')], record('one'))
  const delivery = [...db.deliveries.values()][0]
  delivery.status = 'sent'
  delivery.attempts = 7
  await enqueueDigestBatch([action('b'), action('c')], record('one'))
  assert.equal(delivery.status, 'sent')
  assert.equal(delivery.attempts, 7)
  assert.equal(delivery.digest_count, 3)
  assert.deepEqual([...db.windows.values()][0], new Set(['a', 'b', 'c']))
})

test('shutdown during batch persistence waits for durability before committing the block', async t => {
  storage(t)
  const controller = new AbortController()
  const commits = []
  let release, reached
  const held = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { reached = resolve })
  t.mock.method(Address, 'find', () => ({ lean: async () => [record('a')] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [{ user_id: 123 }] }))
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: 41 } }) }))
  t.mock.method(Counter, 'updateOne', async (_query, update) => commits.push(update.$max['data.seqno']))
  const save = Delivery.updateOne
  t.mock.method(Delivery, 'updateOne', async (...args) => { controller.abort(); reached(); await held; return save(...args) })
  const client = { masterchainInfo: async () => ({ last: { seqno: 42 + config.lagBlocks } }),
    actions: async () => ({ actions: [action('one'), action('two')], metadata: {} }) }
  const pending = scanCycle(client, {}, { signal: controller.signal })
  await started
  assert.deepEqual(commits, [])
  release()
  await pending
  assert.deepEqual(commits, [42])
})

test('a scan cycle flushes each recipient window once before committing its complete prefix', async t => {
  const db = storage(t)
  const commits = []
  t.mock.method(Address, 'find', () => ({ lean: async () => [record('a')] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [{ user_id: 123 }] }))
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: 41 } }) }))
  t.mock.method(Counter, 'updateOne', async (_query, update) => {
    assert.equal([...db.deliveries.values()][0].digest_count, 40)
    commits.push(update.$max['data.seqno'])
  })
  const client = { masterchainInfo: async () => ({ last: { seqno: 1000 + config.lagBlocks } }),
    actions: async ({ mc_seqno }) => ({ actions: [action(String(mc_seqno))], metadata: {} }) }
  await scanCycle(client)
  assert.deepEqual(commits, Array.from({ length: 40 }, (_, index) => 42 + index))
  assert.deepEqual(db.writes(), { windowWrites: 1, deliveryWrites: 1 })
})

test('a failed block flushes saved actions but commits only the contiguous successful prefix', async t => {
  const db = storage(t)
  const commits = []
  t.mock.method(Address, 'find', () => ({ lean: async () => [record('a')] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [{ user_id: 123 }] }))
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: 41 } }) }))
  t.mock.method(Counter, 'updateOne', async (_query, update) => {
    assert(db.deliveries.size > 0)
    commits.push(update.$max['data.seqno'])
  })
  const client = { masterchainInfo: async () => ({ last: { seqno: 1000 + config.lagBlocks } }),
    actions: async ({ mc_seqno }) => {
      if (mc_seqno === 43) throw new Error('block unavailable')
      return { actions: [action(String(mc_seqno))], metadata: {} }
    } }
  await assert.rejects(scanCycle(client), /block unavailable/)
  assert.deepEqual(commits, [42])
  assert([...db.windows.values()][0].has('42'))
  assert(![...db.windows.values()][0].has('43'))
})

test('a failed final window flush leaves all forty blocks uncommitted and replay preserves every ID', async t => {
  const db = storage(t)
  const commits = []
  t.mock.method(Address, 'find', () => ({ lean: async () => [record('a')] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [{ user_id: 123 }] }))
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: 41 } }) }))
  t.mock.method(Counter, 'updateOne', async (_query, update) => commits.push(update.$max['data.seqno']))
  const save = Delivery.updateOne
  let fail = true
  t.mock.method(Delivery, 'updateOne', async (...args) => {
    if (fail && +args[1].$setOnInsert.digest.window_start === 1800000) throw new Error('last flush failed')
    return save(...args)
  })
  const client = { masterchainInfo: async () => ({ last: { seqno: 1000 + config.lagBlocks } }),
    actions: async ({ mc_seqno }) => ({ actions: [action(String(mc_seqno), mc_seqno < 62 ? 1000 : 1900)], metadata: {} }) }
  await assert.rejects(scanCycle(client), /last flush failed/)
  assert.deepEqual(commits, [])
  assert.equal(db.deliveries.size, 1)
  fail = false
  await scanCycle(client)
  assert.deepEqual(commits, Array.from({ length: 40 }, (_, index) => 42 + index))
  assert.deepEqual([...db.deliveries.values()].map(row => row.digest_count), [20, 20])
  const ids = new Set([...db.windows.values()].flatMap(set => [...set]))
  assert.deepEqual(ids, new Set(Array.from({ length: 40 }, (_, index) => String(42 + index))))
})
