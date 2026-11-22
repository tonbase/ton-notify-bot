const test = require('node:test')
const assert = require('node:assert/strict')
const { config } = require('../src/config')
const { Delivery } = require('../src/models')
const { rawAddress, friendlyAddress } = require('../src/address')
const { USDT_MASTER } = require('../src/assets')
const { channelEligible, routeAction } = require('../src/notification-router')
const { formatNotification } = require('../src/events')
const { renderBatch } = require('../src/telegram-sender')

const A = `0:${'A'.repeat(64)}`, B = `0:${'B'.repeat(64)}`
const official = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const transfer = {
  action_id: 'large-usdt', type: 'jetton_transfer', success: true,
  transactions: ['usdt-transaction'],
  details: { sender: A, receiver: B, asset: official, amount: '100000000001' },
}
const watched = { map: new Map(), active: new Set() }

function configure(t) {
  const previous = { channelId: config.channelId, minChannelTon: config.minChannelTon,
    minChannelUsdt: config.minChannelUsdt }
  Object.assign(config, { channelId: '@whales', minChannelTon: '50000', minChannelUsdt: '100000' })
  t.after(() => Object.assign(config, previous))
}

test('USDT channel threshold is strictly greater than 100,000 at six-decimal precision', (t) => {
  configure(t)
  for (const [amount, expected] of [
    ['0', false], ['99999999999', false], ['100000000000', false],
    ['100000000001', true], ['250000000000', true], ['9007199254740993000001', true],
  ]) {
    assert.equal(channelEligible({ ...transfer, details: { ...transfer.details, amount } }), expected, amount)
  }
})

test('USDT matching accepts equivalent official addresses and rejects lookalikes and other actions', (t) => {
  configure(t)
  assert.equal(rawAddress(official), USDT_MASTER)
  for (const asset of [official, USDT_MASTER, USDT_MASTER.toLowerCase(), friendlyAddress(official)]) {
    assert(channelEligible({ ...transfer, details: { ...transfer.details, asset } }), asset)
  }
  for (const asset of [A, 'USDT', '', null, undefined]) {
    assert.equal(channelEligible({ ...transfer, details: { ...transfer.details, asset } }), false)
  }
  for (const type of ['jetton_mint', 'jetton_burn', 'jetton_swap', 'call_contract']) {
    assert.equal(channelEligible({ ...transfer, type }), false, type)
  }
  for (const success of [false, null, undefined]) {
    assert.equal(channelEligible({ ...transfer, success }), false)
  }
})

test('invalid USDT quantities cannot enter the channel queue', (t) => {
  configure(t)
  for (const amount of [null, undefined, '', '-100000000001', '100000000000.1', 'NaN', 'Infinity', '0xFFFFFFFFFFFF']) {
    assert.equal(channelEligible({ ...transfer, details: { ...transfer.details, amount } }), false, String(amount))
  }
  assert.equal(channelEligible({ ...transfer, details: undefined }), false)
})

test('USDT threshold is configurable independently of the existing inclusive GRAM threshold', (t) => {
  configure(t)
  config.minChannelUsdt = '1.000001'
  assert.equal(channelEligible({ ...transfer, details: { ...transfer.details, amount: '1000001' } }), false)
  assert.equal(channelEligible({ ...transfer, details: { ...transfer.details, amount: '1000002' } }), true)
  assert.equal(channelEligible({ type: 'ton_transfer', details: { value: '49999999999999' } }), false)
  assert.equal(channelEligible({ type: 'ton_transfer', details: { value: '50000000000000' } }), true)
  assert.equal(channelEligible({ type: 'ton_transfer', success: false, details: { value: '50000000000000' } }), false)
  config.minChannelUsdt = 'invalid'
  assert.equal(channelEligible(transfer), false)
  config.channelId = ''
  assert.equal(channelEligible(transfer), false)
})

test('official USDT formatting uses verified precision even without or with incorrect provider metadata', () => {
  for (const metadata of [{},
    { [USDT_MASTER]: { token_info: [{ symbol: 'USDt', extra: { decimals: '6' } }] } },
    { [official]: { token_info: [{ symbol: 'WRONG', extra: { decimals: '9' } }] } },
    { [official]: { token_info: [{ symbol: 'WRONG', extra: { decimals: 'invalid' } }] } },
  ]) {
    const output = formatNotification(transfer, A, null, metadata)
    assert.match(output.text, /−100,000\.000001 .*USDT/)
    assert(!output.text.includes('amount unavailable'))
    assert(!output.text.includes('WRONG'))
  }
})

test('large USDT transfers queue once for the channel without subscriptions and retain sender, recipient and tx', async (t) => {
  configure(t)
  const queued = new Map()
  t.mock.method(Delivery, 'updateOne', async (filter, update) => {
    if (!queued.has(filter._id)) queued.set(filter._id, update.$setOnInsert)
  })
  await routeAction(transfer, {}, watched)
  await routeAction(transfer, {}, watched)
  for (const [id, changes] of [
    ['equal', { details: { ...transfer.details, amount: '100000000000' } }],
    ['below', { details: { ...transfer.details, amount: '99999999999' } }],
    ['fake', { details: { ...transfer.details, asset: B } }],
    ['failed', { success: false }], ['unknown', { success: undefined }], ['mint', { type: 'jetton_mint' }],
  ]) await routeAction({ ...transfer, action_id: id, ...changes }, {}, watched)
  assert.equal(queued.size, 1)
  const entry = [...queued.values()][0]
  assert.equal(entry.chat_id, '@whales')
  assert.equal(entry.chat_type, 'channel')
  const rendered = renderBatch([entry], config.channelId)
  for (const html of [rendered.text, rendered.richHtml]) {
    assert.match(html, /<b>100,000\.000001 .*USDT/)
    assert(!html.includes('💵'))
    assert(!html.includes('−100,000'))
    assert(html.includes(encodeURIComponent(friendlyAddress(A))))
    assert(html.includes(encodeURIComponent(friendlyAddress(B))))
    assert(html.includes('usdt-transaction'))
    assert(!html.includes('unknown'))
    assert(!html.includes('tg-emoji'))
  }
  assert(rendered.richHtml.includes('📤'))
  assert(rendered.richHtml.includes('<tg-button type="url"'))
})

test('private USDT notifications still route below the channel threshold', async (t) => {
  configure(t)
  const queued = []
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => queued.push(update.$setOnInsert))
  const record = { _id: 'subscription', address: A, user_id: 123, notifications: { is_enabled: true } }
  const subscriptions = { map: new Map([[A, [record]]]), active: new Set([123]) }
  await routeAction({ ...transfer, details: { ...transfer.details, amount: '100000000000' } }, {}, subscriptions)
  assert.deepEqual(queued.map((entry) => [entry.chat_id, entry.chat_type]), [[123, 'private']])
  const privateMessage = renderBatch([queued[0]], config.channelId)
  assert.match(privateMessage.richHtml, /💵<\/tg-emoji> −100,000 /)
  await routeAction(transfer, {}, subscriptions)
  assert.deepEqual(queued.slice(1).map((entry) => [entry.chat_id, entry.chat_type]), [[123, 'private'], ['@whales', 'channel']])
})
