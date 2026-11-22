const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { config } = require('../src/config')
const { Address, User, Delivery } = require('../src/models')
const { friendlyAddress } = require('../src/address')
const { isIncomingDust, passesFilters, filterAction } = require('../src/notification-filter')
const { routeEntries } = require('../src/notification-router')
const { sendPending } = require('../src/delivery')

const A = `0:${'A'.repeat(64)}`, B = `0:${'B'.repeat(64)}`
const record = { _id: 'recipient', user_id: 123, address: B,
  notifications: { is_enabled: true, min_amount: '0' } }
const transfer = (value = '1000000') => ({ action_id: 'dust', trace_id: 'trace',
  type: 'ton_transfer', success: true, details: { source: A, destination: B, value }, transactions: ['tx'] })

test('incoming dust boundary uses exact native units and normalized recipient identity', (t) => {
  t.mock.property(config, 'minIncomingGramNano', '10000000')
  for (const value of ['0', '1', '1000000', '9999999', '1E+6']) {
    assert.equal(passesFilters(record, transfer(value)), false)
    assert.equal(isIncomingDust({ ...record, address: friendlyAddress(B) }, transfer(value)), true)
  }
  for (const value of ['10000000', '10000001', '999999999999999999999999']) {
    assert.equal(passesFilters(record, transfer(value)), true)
  }
  for (const value of [undefined, null, '-1', 'invalid', '0.5']) {
    assert.equal(isIncomingDust(record, transfer(value === undefined ? 'invalid' : value)), false)
  }
  assert.equal(isIncomingDust(record, { ...transfer(), details: { source: A, destination: B } }), false)
})

test('dust filter preserves outgoing, self, failed, unknown and other asset actions', () => {
  const action = transfer()
  assert.equal(passesFilters({ ...record, address: A }, action), true)
  assert.equal(passesFilters(record, { ...action, details: { ...action.details, source: B } }), true)
  assert.equal(passesFilters(record, { ...action, success: false }), true)
  assert.equal(passesFilters(record, { ...action, success: undefined }), true)
  for (const type of ['jetton_transfer', 'nft_transfer', 'jetton_swap', 'raw_message', 'call_contract', 'stake_deposit']) {
    assert.equal(passesFilters(record, { ...action, type }), true)
  }
  assert.equal(isIncomingDust(record, { ...action, details: { value: '1', destination: B } }), false)
  assert.equal(isIncomingDust({ ...record, address: 'invalid' }, action), false)
})

test('per-address and global opt-outs preserve separate amount and comment filters', (t) => {
  const optedOut = { ...record, notifications: { ...record.notifications, filter_dust: false } }
  assert.equal(passesFilters(optedOut, transfer()), true)
  assert.equal(passesFilters({ ...optedOut, notifications: { ...optedOut.notifications, min_amount: '10000000' } }, transfer()), false)
  const commented = { ...transfer(), details: { ...transfer().details, comment: 'cashback' } }
  assert.equal(passesFilters({ ...record, notifications: { ...record.notifications, inclusion: ['cashback'] } }, commented), false)
  assert.equal(passesFilters({ ...optedOut, notifications: { ...optedOut.notifications, exceptions: ['cashback'] } }, commented), false)
  t.mock.property(config, 'minIncomingGramNano', '0')
  assert.equal(passesFilters(record, transfer('0')), true)
})

test('dust routing suppresses recipient fanout and technical duplicates but retains sender alerts', async (t) => {
  t.mock.property(config, 'channelId', '')
  const sender = { ...record, _id: 'sender', address: A }
  const watched = { map: new Map([[A, [sender]], [B, [record, { ...record, _id: 'second' }]]]), active: new Set([123]) }
  const saved = []
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => saved.push(update.$setOnInsert))
  const action = transfer()
  const technical = { ...action, action_id: 'technical', type: 'call_contract' }
  await routeEntries([{ action, metadata: {} }, { action: technical, metadata: {} }], watched)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].address_id, 'sender')
  assert.deepEqual(saved[0].filter_action, filterAction(action))
})

test('sender checks current dust preference for first and grouped queue entries', async (t) => {
  const events = [
    { _id: 'dust-first', filter_action: filterAction(transfer()) },
    { _id: 'normal', filter_action: filterAction(transfer('10000000')) },
    { _id: 'dust-batched', filter_action: filterAction(transfer()) },
    { _id: 'legacy' },
  ].map(item => ({ chat_id: 123, user_id: '123', address_id: 'recipient', text: item._id, ...item }))
  const skipped = [], sent = []
  t.mock.method(Delivery, 'findOneAndUpdate', async () => events.shift() || null)
  t.mock.method(Address, 'findById', async () => record)
  t.mock.method(User, 'findOne', async () => ({}))
  t.mock.method(Address, 'updateOne', async () => {})
  t.mock.method(Delivery, 'updateOne', async (filter, update) => skipped.push({ id: filter._id, ...update.$set }))
  t.mock.method(Delivery, 'updateMany', async (filter, update) => {
    assert.deepEqual(filter._id.$in, ['normal', 'legacy'])
    assert.equal(update.$set.status, 'sent')
  })
  assert.equal(await sendPending({ sendMessage: async (_chat, text) => sent.push(text) }, {}, { maxMessages: 1, batchSize: 3 }), 1)
  assert.deepEqual(sent, ['normal\n\nlegacy'])
  assert.deepEqual(skipped, ['dust-first', 'dust-batched'].map(id => ({ id, status: 'skipped', skip_reason: 'incoming_dust' })))
})

test('queue schema retains filtering facts and defaults existing subscriptions to enabled', () => {
  const delivery = new Delivery({ filter_action: filterAction(transfer()) })
  assert.deepEqual(delivery.toObject().filter_action, filterAction(transfer()))
  const address = Address.hydrate(record)
  assert.equal(address.notifications.filter_dust, true)
  assert.equal(Address.hydrate({ ...record, notifications: { ...record.notifications, filter_dust: false } }).notifications.filter_dust, false)
})

test('invalid dust configuration fails startup instead of silently disabling filtering', () => {
  for (const value of ['-1', '0.0000000001', 'NaN']) {
    const run = spawnSync(process.execPath, ['-e', "require('./src/config')"], {
      cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', env: { ...process.env, MIN_INCOMING_GRAM: value },
    })
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /MIN_INCOMING_GRAM must be/)
  }
})
