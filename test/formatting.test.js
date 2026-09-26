const test = require('node:test')
const assert = require('node:assert/strict')
const { formatAction, formatNotification, participants } = require('../src/events')
const { formatDisplayUnits } = require('../src/amount')
const A = `0:${'A'.repeat(64)}`
const T = `0:${'B'.repeat(64)}`
const metadata = { [T]: { token_info: [{ symbol: 'USDT', extra: { decimals: '6' } }] } }
const plain = (text) => text.replace(/<[^>]+>/g, '')

test('mint, burn, swap, liquidity and staking show units rather than raw nano amounts', () => {
  for (const type of ['jetton_mint', 'jetton_burn']) {
    assert.match(plain(formatAction({ type, details: { asset: T, amount: '1250000' } }, A, null, metadata)), /1.25 USDT/)
  }
  const swap = { type: 'jetton_swap', details: {
    dex_incoming_transfer: { asset: null, amount: '1500000000' },
    dex_outgoing_transfer: { asset: T, amount: '2300000' },
  } }
  assert.match(plain(formatAction(swap, A, null, metadata)), /1.5 TON → 2.3 USDT/)
  const stake = { type: 'stake_deposit', details: { stake_holder: A, amount: '123400000000' } }
  assert(participants(stake).includes(A))
  assert.match(formatAction(stake, A), /123.4 TON/)
  assert.match(plain(formatAction({ type: 'dex_deposit_liquidity', details: {
    asset_1: T, amount_1: '1000000', asset_2: null, amount_2: '1000000000',
  } }, A, null, metadata)), /1 USDT \+ 1 TON/)
})

test('NFT purchase direction uses real seller and distinguishes payout from price', () => {
  const text = formatAction({ type: 'nft_transfer', details: {
    old_owner: T, real_old_owner: A, is_purchase: true, payout_amount: '5000000000',
  } }, A)
  assert.match(text, /^<b>Sold · /)
  assert.match(text, /Seller payout: 5 TON/)
})

test('plain notifications show a short quote without mutating references or implying a purchase', () => {
  const comment = '90 Telegram Stars Ref#example123'
  const action = { type: 'ton_transfer', success: true, transactions: ['test/hash'], details: {
    source: A, destination: T, value: '919800000', comment,
  } }
  const output = formatNotification(action, A, { tag: 'Main wallet' })
  assert.match(plain(output.text).split('\n')[0], /^−0.9198 TON/)
  assert.match(output.text, /<i>“90 Telegram Stars”<\/i>/)
  assert.equal(action.details.comment, comment)
  assert.equal(output.richHtml, undefined)
  assert(!output.text.includes('Bought'))
  assert(output.text.includes('test%2Fhash'))
  assert.equal(output.text.split('\n').length, 3)
  action.details.comment = '<b>Untrusted</b> '.repeat(10)
  assert(formatNotification(action, A).text.includes('&lt;b&gt;Untrusted&lt;/b&gt;'))
  action.details.encrypted = true
  assert(!formatNotification(action, A).text.includes('Untrusted'))
})

test('short swap amounts mark rounding, keep large integer precision and never erase tiny values', () => {
  assert.equal(formatDisplayUnits('520729196'), '≈0.520729')
  assert.equal(formatDisplayUnits('999999999'), '≈1')
  assert.equal(formatDisplayUnits('1'), '0.000000001')
  assert.equal(formatDisplayUnits('12345', 18), '≈0.00000000000001235')
  assert.equal(formatDisplayUnits('123456789123456789'), '≈123,456,789.123457')
  assert.equal(formatDisplayUnits('25000000', 6), '25')
})

test('failed and self transfers never imply a successful balance change', () => {
  const action = { type: 'ton_transfer', success: false, details: { source: A, destination: T, value: '1000000000' } }
  const failed = plain(formatNotification(action, A).text)
  assert.match(failed, /^⚠︎ Failed · 1 TON/)
  assert(!failed.includes('−1 TON'))
  action.success = true; action.details.destination = A
  const self = plain(formatNotification(action, A).text)
  assert.match(self, /^1 TON/)
  assert.match(self, /Self/)
})
