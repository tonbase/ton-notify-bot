const test = require('node:test')
const assert = require('node:assert/strict')
const { Address } = require('@ton/core')
const { rawAddress } = require('../src/address')
const { formatUnits, toNano } = require('../src/amount')
const { formatAction, formatNotification, participants, passesFilters } = require('../src/events')
const { parseAddressInput, parseWordFilters } = require('../src/bot')
const { scanBlock, deliveryId, shouldSuppress } = require('../src/scanner')

const A = `0:${'A'.repeat(64)}`
const B = `0:${'B'.repeat(64)}`
const TOKEN = `0:${'C'.repeat(64)}`

test('friendly and raw address forms have the same identity', () => {
  const friendly = Address.parseRaw(A).toString({ bounceable: false, urlSafe: true })
  assert.equal(rawAddress(friendly), A)
  assert.equal(parseAddressInput(`${friendly}:My wallet`).tag, 'My wallet')
  assert.equal(parseAddressInput(`${A}:Treasury`).address, A)
  assert.equal(parseAddressInput('not an address'), null)
})

test('amounts preserve integer precision and reject overprecise input', () => {
  assert.equal(toNano('0.000000001'), '1')
  assert.equal(toNano('123456789.123456789'), '123456789123456789')
  assert.equal(toNano('0.1234567891'), null)
  assert.equal(formatUnits('123456789123456789', 9), '123,456,789.123456789')
})

test('jetton transfer uses token decimals and escapes untrusted metadata', () => {
  const action = { type: 'jetton_transfer', success: true, action_id: 'a', details: {
    sender: A, receiver: B, asset: TOKEN, amount: '12345678', comment: '<script>x</script>',
  }, transactions: ['hash'] }
  const metadata = { [TOKEN]: { token_info: [{ valid: true, symbol: '<USDT>', extra: { decimals: '6' } }] } }
  const text = formatAction(action, A, { tag: '<Owner>' }, metadata)
  assert.match(text.replace(/<[^>]+>/g, ''), /12\.345678 &lt;USDT&gt;/)
  assert.match(text, /&lt;Owner&gt;/)
  assert.match(text, /&lt;script&gt;x&lt;\/script&gt;/)
  assert.equal(participants(action).includes(TOKEN), false)
})

test('NFT transfer is associated with both owners', () => {
  const action = { type: 'nft_transfer', success: true, transactions: ['hash'], details: { old_owner: A, new_owner: B, nft_item: TOKEN } }
  assert.deepEqual(participants(action), [A, B])
  assert.match(formatAction(action, B), /^📥 \+ <b>/)
  assert.match(formatNotification(action, B).richHtml, /^<p><tg-emoji emoji-id="5372835488354815966">📥<\/tg-emoji>/)
})

test('minimum GRAM amount does not suppress jetton or NFT events', () => {
  const record = { notifications: { is_enabled: true, min_amount: '1000000000', exceptions: [], inclusion: [] } }
  assert.equal(passesFilters(record, { type: 'ton_transfer', details: { value: '1' } }), false)
  assert.equal(passesFilters(record, { type: 'jetton_transfer', details: { amount: '1' } }), true)
  assert.deepEqual(parseWordFilters('+cashback, -ads, -ads'), { exceptions: ['ads'], inclusion: ['cashback'] })
})

test('block scanner requests every page and processes more than 500 actions', async () => {
  let calls = 0
  const client = { actions: async ({ offset }) => {
    calls += 1
    const size = offset === 0 ? 500 : 1
    return { actions: Array.from({ length: size }, (_, i) => ({ action_id: `${offset + i}`, type: 'unknown', details: {}, accounts: [] })) }
  }, transactionsByMasterchainBlock: async () => ({ transactions: [] }) }
  const count = await scanBlock(client, 42, { map: new Map(), active: new Set() })
  assert.equal(count, 501)
  assert.equal(calls, 2)
  assert.notEqual(deliveryId('action', 'user1'), deliveryId('action', 'user2'))
})

test('low-level contract calls in a classified transfer trace are collapsed', () => {
  const traces = new Set(['trace-1'])
  assert.equal(shouldSuppress({ type: 'call_contract', trace_id: 'trace-1' }, traces), true)
  assert.equal(shouldSuppress({ type: 'call_contract', trace_id: 'trace-2' }, traces), false)
  assert.equal(shouldSuppress({ type: 'nft_transfer', trace_id: 'trace-1' }, traces), false)
})
