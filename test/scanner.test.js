const test = require('node:test')
const assert = require('node:assert/strict')
const { Address, User, Counter, Delivery } = require('../src/models')
const { scanCycle, sendPending, rawFallbacks } = require('../src/scanner')
const { config } = require('../src/config')

const A = `0:${'A'.repeat(64)}`
const B = `0:${'B'.repeat(64)}`

test('parallel blocks never commit beyond a failed block', async (t) => {
  let cursor = 41
  let failing = true
  const commits = []
  t.mock.method(Address, 'find', () => ({ lean: async () => [] }))
  t.mock.method(User, 'find', () => ({ lean: async () => [] }))
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { seqno: cursor } }) }))
  t.mock.method(Counter, 'updateOne', async (_filter, update) => { cursor = update.$max['data.seqno']; commits.push(cursor) })
  const client = {
    masterchainInfo: async () => ({ last: { seqno: 45 + config.lagBlocks } }),
    actions: async ({ mc_seqno }) => {
      if (failing && mc_seqno === 43) throw new Error('block temporarily unavailable')
      return { actions: [] }
    },
    transactionsByMasterchainBlock: async () => ({ transactions: [] }),
  }
  await assert.rejects(() => scanCycle(client), /temporarily unavailable/)
  assert.deepEqual(commits, [42])
  failing = false
  await scanCycle(client)
  assert.deepEqual(commits, [42, 43, 44, 45])
})

test('scanner commits only blocks whose notifications were durably queued', async () => {
  const original = {
    addressFind: Address.find, userFind: User.find,
    counterFindOne: Counter.findOne, counterUpdateOne: Counter.updateOne,
    deliveryUpdateOne: Delivery.updateOne,
  }
  const commits = []
  const queued = []
  let failQueue = true
  try {
    Address.find = () => ({ lean: async () => [{
      _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', user_id: 123, address: A, tag: 'Test', is_deleted: false,
      notifications: { is_enabled: true, min_amount: '0', exceptions: [], inclusion: [] },
    }] })
    User.find = () => ({ lean: async () => [{ user_id: 123, is_blocked: false, is_deactivated: false }] })
    Counter.findOne = () => ({ lean: async () => ({ data: { seqno: 41 } }) })
    Counter.updateOne = async (_filter, update) => { commits.push(update.$max['data.seqno']) }
    Delivery.updateOne = async (filter) => {
      if (failQueue) throw new Error('MongoDB write failed')
      queued.push(filter._id)
    }
    const client = {
      masterchainInfo: async () => ({ last: { seqno: 43 + config.lagBlocks } }),
      actions: async ({ mc_seqno }) => ({
        actions: [{
          action_id: `action-${mc_seqno}`, trace_id: `trace-${mc_seqno}`,
          type: 'ton_transfer', success: true,
          details: { source: A, destination: B, value: '1000000000' },
          transactions: [`hash-${mc_seqno}`],
        }], metadata: {},
      }),
      transactionsByMasterchainBlock: async () => ({ transactions: [] }),
    }
    await assert.rejects(() => scanCycle(client, {}), /MongoDB write failed/)
    assert.deepEqual(commits, [])
    failQueue = false
    await scanCycle(client, {})
    assert.deepEqual(commits, [42, 43])
    assert.equal(new Set(queued).size, 2)
  } finally {
    Address.find = original.addressFind
    User.find = original.userFind
    Counter.findOne = original.counterFindOne
    Counter.updateOne = original.counterUpdateOne
    Delivery.updateOne = original.deliveryUpdateOne
  }
})

test('raw fallback preserves multiple uncovered messages without duplicating classified transfers', () => {
  const first = { hash: 'msg-1', source: A, destination: B, value: '0' }
  const second = { hash: 'msg-2', source: A, destination: B, value: '100' }
  const transactions = [
    { hash: 'tx-1', account: A, out_msgs: [first, second] },
    { hash: 'tx-2', account: B, in_msg: first, out_msgs: [] },
    { hash: 'tx-3', account: B, in_msg: second, out_msgs: [] },
  ]
  const fallback = rawFallbacks(transactions, [])
  assert.deepEqual(fallback.map((item) => item.action_id), ['raw-message:msg-1', 'raw-message:msg-2'])
  assert.deepEqual(rawFallbacks(transactions, [{ transactions: ['tx-1'] }]), [])
})

test('a failed counter update cannot reschedule a delivered Telegram message', async () => {
  const original = {
    deliveryFind: Delivery.findOneAndUpdate, deliveryUpdate: Delivery.updateOne,
    addressFind: Address.findById, addressUpdate: Address.updateOne,
    userFind: User.findOne, error: console.error,
  }
  let claimed = false
  const states = []
  let telegramCalls = 0
  try {
    Delivery.findOneAndUpdate = async () => {
      if (claimed) return null
      claimed = true
      return { _id: 'delivery', address_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', user_id: '123', chat_id: 123, text: 'Hi' }
    }
    Delivery.updateOne = async (_filter, update) => { states.push(update.$set.status) }
    Address.findById = async () => ({ is_deleted: false, notifications: { is_enabled: true } })
    User.findOne = async () => ({ is_blocked: false, is_deactivated: false })
    Address.updateOne = async () => { throw new Error('counter unavailable') }
    console.error = () => {}
    const sent = await sendPending({ sendMessage: async () => { telegramCalls += 1 } })
    assert.equal(sent, 1)
    assert.equal(telegramCalls, 1)
    assert.deepEqual(states, ['sent'])
  } finally {
    Delivery.findOneAndUpdate = original.deliveryFind
    Delivery.updateOne = original.deliveryUpdate
    Address.findById = original.addressFind
    Address.updateOne = original.addressUpdate
    User.findOne = original.userFind
    console.error = original.error
  }
})
