const test = require('node:test')
const assert = require('node:assert/strict')
const { Counter, Address, User } = require('../src/models')
const { config } = require('../src/config')
const { WINDOW_MS } = require('../src/digest')
const { loadRecoveryState, validateRecovery, deliveryPolicy, LIVE_CURSOR_NAME, backfillCapacityReady, initializeBackfill } = require('../src/recovery-mode')
const { scanCycle } = require('../src/block-scanner')
const { deliveryOperation, readyQuery } = require('../src/delivery-queue')

test('historical ingestion pauses before the global guard with hysteresis on both volumes', async () => {
  const state = {}
  let free = { app: 8, data: 6.5 }
  const options = { volumes: ['app', 'data'], fileSystem: {
    statfs: async volume => ({ bavail: free[volume] * 1024, bsize: 1024 ** 2, blocks: 25 * 1024 }),
  } }
  assert.equal(await backfillCapacityReady(state, options), false)
  free.data = 7
  assert.equal(await backfillCapacityReady(state, options), true)
  free.data = 6.5
  assert.equal(await backfillCapacityReady(state, options), true)
  free.app = 5.9
  assert.equal(await backfillCapacityReady(state, options), false)
  free.app = 6.5
  assert.equal(await backfillCapacityReady(state, options), false)
  free.app = 7
  assert.equal(await backfillCapacityReady(state, options), false)
  free.data = 7
  assert.equal(await backfillCapacityReady(state, options), true)
})

test('failed or invalid capacity measurements never permit historical ingestion', async () => {
  for (const stat of [{ bavail: NaN, bsize: 1, blocks: 100 }, { bavail: 100, bsize: 1, blocks: 0 },
    { bavail: 101, bsize: 1, blocks: 100 }]) {
    await assert.rejects(backfillCapacityReady({}, { volumes: ['data'], fileSystem: { statfs: async () => stat } }), /measurement/)
  }
  const state = { capacityPaused: false }
  await assert.rejects(backfillCapacityReady(state, { volumes: ['data'], fileSystem: { statfs: async () => { throw Error('EIO') } } }), /EIO/)
  assert.equal(state.capacityPaused, true)
  assert.equal(await backfillCapacityReady(state, { volumes: ['data'], fileSystem: {
    statfs: async () => ({ bavail: 6.5 * 1024, bsize: 1024 ** 2, blocks: 25 * 1024 }),
  } }), false)
  assert.equal(deliveryPolicy({ endSeqno: 100, digestFrom: new Date(900000) },
    { ready: true, tip: 200, lastProcessed: 200, lastSuccessMs: 1000 },
    { capacityPaused: true, complete: false, lastProcessed: 50 }, 2000).excludeDigests, false)
})

test('a completed historical cursor releases old summaries after restart without needing ingestion capacity', async t => {
  t.mock.method(Counter, 'findOne', ({ name }) => {
    assert.equal(name, 'actions_scan_v1')
    return { lean: async () => ({ data: { seqno: 100 } }) }
  })
  t.mock.method(Counter, 'updateOne', async () => assert.fail('read-only initialization'))
  const state = {}
  await initializeBackfill(state, 100)
  assert.equal(state.complete, true)
  const policy = deliveryPolicy({ endSeqno: 100, digestFrom: new Date(900000) },
    { ready: true, tip: 200, lastProcessed: 200, lastSuccessMs: 1000 }, state, 2000)
  assert.equal(policy.backfillComplete, true)
  assert.equal(policy.digestNotBefore, undefined)
  const paused = await backfillCapacityReady({}, { volumes: ['data'], fileSystem: {
    statfs: async () => ({ bavail: 6.5 * 1024, bsize: 1024 ** 2, blocks: 25 * 1024 }),
  } })
  assert.equal(paused, false)
})

test('initializing historical progress cannot synthesize a missing or corrupt cursor', async t => {
  let saved
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => saved }))
  for (const record of [null, { data: { seqno: '100' } }, { data: { seqno: -1 } }]) {
    saved = record
    await assert.rejects(initializeBackfill({}, 100), /cursor/)
  }
})

test('recovery boundary is inserted once and reused without consulting a newer head', async t => {
  let stored
  t.mock.method(Counter, 'findOne', query => {
    assert.equal(query.name, LIVE_CURSOR_NAME)
    return { lean: async () => stored }
  })
  t.mock.method(Counter, 'findOneAndUpdate', async (_query, update, options) => {
    assert.deepEqual(Object.keys(update), ['$setOnInsert'])
    assert.equal(options.upsert, true)
    stored ||= update.$setOnInsert
    return stored
  })
  const recovery = await loadRecoveryState({ masterchainInfo: async () => ({ last: { seqno: 1000, gen_utime: '1800000000' } }) })
  assert.equal(recovery.startSeqno, 1001 - config.lagBlocks)
  assert.equal(+recovery.digestFrom, 1800000000000 + WINDOW_MS)
  stored.data.seqno += 100
  assert.deepEqual(await loadRecoveryState({ masterchainInfo: async () => { throw Error('must not reset') } }), recovery)
})

test('concurrent initialization reads the winning boundary and invalid metadata fails closed', async t => {
  let reads = 0
  const data = { seqno: 199, start_seqno: 200, digest_from_ms: WINDOW_MS }
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ++reads > 1 ? { data } : null }))
  t.mock.method(Counter, 'findOneAndUpdate', async () => { throw { code: 11000 } })
  assert.equal((await loadRecoveryState({ masterchainInfo: async () => ({ last: { seqno: 1000, gen_utime: '1800000000' } }) })).startSeqno, 200)
  for (const invalid of [null, { ...data, seqno: 198 }, { ...data, digest_from_ms: 1 }]) assert.throws(() => validateRecovery(invalid))
  reads = 0
  await assert.rejects(loadRecoveryState({ masterchainInfo: async () => ({ last: { seqno: 1000, gen_utime: 'bad' } }) }), /metadata/)
})

test('separate ranges cover the cutover exactly and live replay cannot enter historical blocks', async t => {
  const cursors = { actions_scan_v1: 97, [LIVE_CURSOR_NAME]: 100 }
  const fetched = []
  const commits = []
  t.mock.method(Address, 'find', () => ({ lean: async () => [] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [] }))
  t.mock.method(Counter, 'findOne', ({ name }) => ({ lean: async () => ({ data: { seqno: cursors[name] } }) }))
  t.mock.method(Counter, 'updateOne', async ({ name }, update) => {
    cursors[name] = Math.max(cursors[name], update.$max['data.seqno'])
    commits.push([name, cursors[name]])
  })
  const client = { masterchainInfo: async () => ({ last: { seqno: 102 + config.lagBlocks } }),
    actions: async ({ mc_seqno }) => { fetched.push(mc_seqno); return { actions: [] } } }
  await scanCycle(client, {}, { endSeqno: 100, replayBlocks: 0 })
  assert.deepEqual(fetched, [98, 99, 100])
  const live = {}
  await scanCycle(client, live, { cursorName: LIVE_CURSOR_NAME, startSeqno: 101, replayBlocks: 20 })
  await scanCycle(client, live, { cursorName: LIVE_CURSOR_NAME, startSeqno: 101, replayBlocks: 20 })
  await scanCycle(client, live, { cursorName: LIVE_CURSOR_NAME, startSeqno: 101, replayBlocks: 20 })
  assert(fetched.slice(3).every(block => block >= 101))
  assert.deepEqual(cursors, { actions_scan_v1: 100, [LIVE_CURSOR_NAME]: 102 })
  assert(commits.filter(([name]) => name === LIVE_CURSOR_NAME).every(([, block]) => block > 100))
})

test('digests require fresh successful live progress and historical completion releases old windows', () => {
  const recovery = { endSeqno: 100, digestFrom: new Date(WINDOW_MS) }
  const live = { ready: true, lastSuccessMs: 1000, lastProcessed: 200, tip: 200 }
  const backfill = { complete: false, lastProcessed: 99 }
  assert.equal(deliveryPolicy(recovery, live, backfill, 2000).digestNotBefore, recovery.digestFrom)
  assert.equal(deliveryPolicy(recovery, live, backfill, 2000).excludeDigests, false)
  for (const state of [{ ...live, ready: false }, { ...live, tip: 201 }, { ...live, lastSuccessMs: 0 }]) {
    assert.equal(deliveryPolicy(recovery, state, backfill, 120001).excludeDigests, true)
  }
  assert.equal(deliveryPolicy(recovery, live, { complete: true, lastProcessed: 100 }, 2000).digestNotBefore, undefined)
  assert.equal(deliveryPolicy(recovery, live, { complete: true, lastProcessed: 99 }, 2000).backfillComplete, false)
})

test('recovery never recreates a missing or corrupt cursor at the tip', async t => {
  let data
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => data ? { data } : null }))
  t.mock.method(Counter, 'updateOne', async () => { assert.fail('must not initialize or reset a recovery cursor') })
  const client = { masterchainInfo: async () => ({ last: { seqno: 200 + config.lagBlocks } }) }
  for (const value of [null, { seqno: '100' }, { seqno: -1 }]) {
    data = value
    await assert.rejects(scanCycle(client, {}, { endSeqno: 100, requireExistingCursor: true }), /cursor/)
  }
  data = { seqno: 90 }
  await assert.rejects(scanCycle(client, {}, { cursorName: LIVE_CURSOR_NAME, startSeqno: 101, requireExistingCursor: true }), /cursor/)
})

test('live tags preserve deterministic identities and bound queries preserve expired-lease checks', () => {
  const action = { action_id: 'same-action' }
  const normal = deliveryOperation(action, 123, { text: 'text' })
  const live = deliveryOperation(action, 123, { text: 'text' }, undefined, 'live')
  assert.equal(live.updateOne.filter._id, normal.updateOne.filter._id)
  assert.deepEqual(Object.keys(live.updateOne.update), ['$setOnInsert'])
  assert.equal(live.updateOne.update.$setOnInsert.delivery_lane, 'live')
  const bound = new Date(WINDOW_MS)
  const query = readyQuery(new Date(), { deliveryKind: 'digest', digestNotBefore: bound })
  assert.equal(query['digest.window_start'].$gte, bound)
  assert.equal(query.$or.length, 2)
  assert.equal(readyQuery(new Date(), { digestNotBefore: bound })['digest.window_start'].$exists, false)
})
