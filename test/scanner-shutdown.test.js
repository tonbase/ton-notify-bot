const test = require('node:test')
const assert = require('node:assert/strict')
const { Address, User, Counter } = require('../src/models')
const { scanCycle } = require('../src/block-scanner')
const { config } = require('../src/config')

test('shutdown finishes and commits the current group without scanning more blocks or replaying', async t => {
  const controller = new AbortController()
  const fetched = []
  const committed = []
  t.mock.method(Address, 'find', () => ({ lean: async () => [] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [] }))
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: 41 } }) }))
  t.mock.method(Counter, 'updateOne', async (_filter, update) => committed.push(update.$max['data.seqno']))
  const client = {
    masterchainInfo: async () => ({ last: { seqno: 81 + config.lagBlocks } }),
    actions: async ({ mc_seqno }) => {
      fetched.push(mc_seqno)
      controller.abort()
      return { actions: [] }
    },
  }
  const state = await scanCycle(client, {}, { signal: controller.signal })
  const group = Array.from({ length: config.blockConcurrency }, (_, index) => 42 + index)
  assert.deepEqual(fetched, group)
  assert.deepEqual(committed, group)
  assert.equal(state.lastProcessed, group.at(-1))
})
