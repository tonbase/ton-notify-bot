const test = require('node:test')
const assert = require('node:assert/strict')
const { formatAction, participants } = require('../src/events')
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
  assert.match(text, /📤 <b>Send<\/b>/)
  assert.match(text, /Seller payout: 5 TON/)
})
