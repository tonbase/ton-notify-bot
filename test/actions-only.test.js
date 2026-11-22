const test = require('node:test')
const assert = require('node:assert/strict')
const { config } = require('../src/config')
const { Address, User, Counter, Delivery } = require('../src/models')
const { TonCenter } = require('../src/toncenter')
const { scanCycle } = require('../src/block-scanner')

test('bounded block replay picks up a late action once using only the actions API', async (t) => {
  t.mock.property(config, 'startSeqno', null)
  t.mock.property(config, 'lagBlocks', 0)
  t.mock.property(config, 'replayBlocks', 1)
  t.mock.property(config, 'channelId', '')
  const A = `0:${'A'.repeat(64)}`, B = `0:${'B'.repeat(64)}`
  const watched = { _id: 'subscription', user_id: 123, address: A,
    notifications: { is_enabled: true, min_amount: '0' } }
  t.mock.method(Address, 'find', () => ({ lean: async () => [watched] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [{ user_id: 123 }] }))
  let cursor = 99, published = false
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: cursor } }) }))
  t.mock.method(Counter, 'updateOne', async (_filter, update) => { cursor = update.$max['data.seqno'] })
  const saved = new Map(), paths = []
  t.mock.method(Delivery, 'updateOne', async (filter, update, options) => {
    assert.equal(options.upsert, true)
    if (!saved.has(filter._id)) saved.set(filter._id, update.$setOnInsert)
  })
  const client = new TonCenter({ baseUrl: 'https://indexer.invalid/api/v3', apiKey: 'test', attempts: 1,
    limiter: { run: (operation) => operation() }, fetch: async (url) => {
      paths.push(url.pathname)
      if (url.pathname === '/api/v3/masterchainInfo') return Response.json({ last: { seqno: 100 } })
      assert.equal(url.pathname, '/api/v3/actions', 'scanning must not fetch raw blocks or traces')
      assert.equal(url.searchParams.get('mc_seqno'), '100')
      return Response.json({ actions: published ? [{ action_id: 'late-transfer', type: 'ton_transfer', success: true,
        trace_id: 'classified-trace', details: { source: A, destination: B, value: '2000000000' }, transactions: ['tx'] }] : [] })
    } })
  const state = {}
  await scanCycle(client, state)
  assert.equal(cursor, 100)
  assert.equal(saved.size, 0)
  published = true
  await scanCycle(client, state)
  assert.equal(saved.size, 1, 'replay must recover the action after the block cursor advanced')
  const first = [...saved.values()][0]
  assert.match(first.text, /2 GRAM/)
  await scanCycle(client, state)
  assert.equal(saved.size, 1, 'replay must reuse the same durable delivery ID')
  assert.equal([...saved.values()][0], first, 'the original queued notification stays unchanged')
  assert.equal(paths.filter(path => path === '/api/v3/actions').length, 4)
})
