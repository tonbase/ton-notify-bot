const test = require('node:test')
const assert = require('node:assert/strict')
const { Delivery, TraceTask, Address, User } = require('../src/models')
const { sendPending, reconcileTraces, routeEntries } = require('../src/scanner')

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

test('incomplete traces remain pending across retries; completed traces resolve after durable routing', async (t) => {
  const A = `0:${'A'.repeat(64)}`
  const B = `0:${'B'.repeat(64)}`
  const task = { _id: 'trace', trace_id: 'trace', attempts: 0 }
  const updates = []
  const deliveries = []
  t.mock.method(TraceTask, 'find', () => ({ sort: () => ({ limit: () => ({ lean: async () => [task] }) }) }))
  t.mock.method(TraceTask, 'updateOne', async (_filter, update) => updates.push(update))
  const watched = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', user_id: 123, address: A,
    notifications: { is_enabled: true, min_amount: '0' } }
  t.mock.method(Address, 'find', () => ({ lean: async () => [watched] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [{ user_id: 123 }] }))
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => deliveries.push(update))
  let complete = false
  const client = {
    get: async () => ({ traces: [{ trace_id: 'trace', is_incomplete: !complete,
      trace_info: { trace_state: complete ? 'complete' : 'pending', pending_messages: complete ? 0 : 1, transactions: 1 },
      transactions: { tx: { hash: 'tx', account: A } } }] }),
    actions: async () => ({ actions: [{ action_id: 'jetton', trace_id: 'trace', type: 'jetton_transfer',
      details: { sender: A, receiver: B, amount: '100', asset: B }, transactions: ['tx'] }] }),
  }
  await reconcileTraces(client)
  assert.equal(deliveries.length, 0)
  assert.equal(updates.some((update) => update.$set?.status === 'done'), false)
  complete = true
  await reconcileTraces(client)
  assert.equal(deliveries.length, 1)
  assert.equal(updates.at(-1).$set.status, 'done')
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
