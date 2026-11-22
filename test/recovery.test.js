const test = require('node:test')
const assert = require('node:assert/strict')
const { Delivery, Counter } = require('../src/models')
const { sendPending } = require('../src/delivery')
const { routeEntries } = require('../src/notification-router')
const { loadDeliveryState } = require('../src/delivery-state')

test('Telegram flood wait survives a scanner restart and pauses the shared sender', async (t) => {
  let storedUntil = 0
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => storedUntil ? { data: { untilMs: storedUntil } } : null }))
  t.mock.method(Counter, 'updateOne', async (_filter, update) => { storedUntil = Math.max(storedUntil, update.$max['data.untilMs']) })
  let claimed = false
  t.mock.method(Delivery, 'findOneAndUpdate', async () => {
    if (claimed) return null
    claimed = true
    return { _id: 'first', chat_id: 123, text: 'Event', attempts: 1 }
  })
  t.mock.method(Delivery, 'updateOne', async () => {})
  const state = await loadDeliveryState()
  await sendPending({ sendMessage: async () => { throw { error_code: 429, parameters: { retry_after: 286 } } } }, state)
  assert(storedUntil > Date.now() + 285000)
  const restarted = await loadDeliveryState()
  assert.equal(restarted.cooldownUntil, storedUntil)
  let resumed = false
  const sent = await sendPending({ sendMessage: async () => { resumed = true } }, restarted)
  assert.equal(sent, 0)
  assert.equal(resumed, false)
})

test('Telegram 429 persists retry and stops the entire sender until retry_after', async (t) => {
  const updates = []
  let claims = 0
  let sends = 0
  t.mock.method(Delivery, 'findOneAndUpdate', async () => {
    claims += 1
    return { _id: 'd', chat_id: 123, text: 'test', attempts: 1 }
  })
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => updates.push(update))
  t.mock.method(console, 'error', () => {})
  const api = { sendMessage: async () => { sends += 1; throw { error_code: 429, parameters: { retry_after: 30 }, description: 'Too Many Requests' } } }
  const state = {}
  await sendPending(api, state)
  assert.equal(updates[0].$set.status, 'pending')
  assert(updates[0].$set.next_attempt_at.getTime() > Date.now() + 29000)
  await sendPending(api, state)
  assert.equal(claims, 1)
  assert.equal(sends, 1)
})

test('collapsing a contract call preserves a different watched participant in the same trace', async (t) => {
  const A = `0:${'A'.repeat(64)}`
  const B = `0:${'B'.repeat(64)}`
  const records = [A, B].map((address, index) => ({ _id: String(index), user_id: index + 1, address, notifications: { is_enabled: true } }))
  const queued = []
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => queued.push(update.$setOnInsert))
  await routeEntries([
    { action: { action_id: 'transfer', type: 'ton_transfer', trace_id: 't', transactions: ['tx'], details: { source: A, value: '1' } } },
    { action: { action_id: 'call', type: 'call_contract', trace_id: 't', transactions: ['tx'], details: { source: B, destination: A } } },
    { action: { action_id: 'other-call', type: 'call_contract', trace_id: 't', transactions: ['other-tx'], details: { source: A } } },
  ], { map: new Map([[A, [records[0]]], [B, [records[1]]]]), active: new Set([1, 2]) })
  assert.deepEqual(queued.map((item) => [item.action_id, item.chat_id]), [['transfer', 1], ['call', 2], ['other-call', 1]])
})
