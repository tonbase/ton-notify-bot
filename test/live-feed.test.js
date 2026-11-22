const test = require('node:test')
const assert = require('node:assert/strict')
const { chooseSample, createPageLoader } = require('../src/live-feed')
const A = `0:${'A'.repeat(64)}`
const B = `0:${'B'.repeat(64)}`
const action = (id, lt, success = true) => ({ action_id: id, type: 'ton_transfer', end_lt: lt,
  success, transactions: ['hash'], details: { source: A, destination: B, value: '1000000000' } })

test('continuous sampling respects saved cursors and delivered IDs, and varies participant perspective', () => {
  const page = { actions: [action('old', '99'), action('same', '100'), action('fresh', '101')] }
  const sample = chooseSample(page, 'ton_transfer', { lastLt: '100', selected: 0 }, new Set(['same']))
  assert.equal(sample.action.action_id, 'fresh'); assert.equal(sample.address, A)
  assert.equal(chooseSample(page, 'ton_transfer', { lastLt: '100', selected: 1 }).address, B)
  assert.equal(chooseSample(page, 'ton_transfer', { lastLt: '101' }, new Set(['fresh'])), null)
  assert.equal(chooseSample({ actions: [action('invalid', 'not-an-lt')] }, 'ton_transfer'), null)
})

test('failure sampling never rolls the cursor back or duplicates categories through the other lane', () => {
  const page = { actions: [action('failed', '98', false), action('fresh', '101')] }
  assert.equal(chooseSample(page, 'ton_transfer', { lastLt: '100', selected: 3 }).action.action_id, 'fresh')
  page.actions.push(action('new-failure', '102', false))
  assert.equal(chooseSample(page, 'ton_transfer', { lastLt: '100', selected: 3 }).action.action_id, 'new-failure')
  assert.equal(chooseSample(page, 'other'), null)
})

test('system events use a confirmed transaction account when the action omits participants', async () => {
  const account = `-1:${'C'.repeat(64)}`
  const loader = createPageLoader({
    actions: async params => {
      assert.equal(params.limit, 1)
      return { actions: [{ action_id: 'tick', type: 'tick_tock', end_lt: '101', transactions: ['hash'], details: {} }] }
    },
    get: async (_path, params) => {
      assert.equal(params.hash, 'hash')
      return { transactions: [{ hash: 'hash', account }] }
    },
  })
  const sample = chooseSample(await loader('tick_tock'), 'tick_tock')
  assert.equal(sample.address, account)
})
