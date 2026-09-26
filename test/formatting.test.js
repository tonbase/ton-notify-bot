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
  assert.match(plain(formatAction(swap, A, null, metadata)), /1.5 GRAM → 2.3 USDT/)
  const stake = { type: 'stake_deposit', details: { stake_holder: A, amount: '123400000000' } }
  assert(participants(stake).includes(A))
  assert.match(formatAction(stake, A), /123.4 GRAM/)
  assert.match(plain(formatAction({ type: 'dex_deposit_liquidity', details: {
    asset_1: T, amount_1: '1000000', asset_2: null, amount_2: '1000000000',
  } }, A, null, metadata)), /1 USDT \+ 1 GRAM/)
})

test('NFT purchase direction uses real seller and distinguishes payout from price', () => {
  const text = formatAction({ type: 'nft_transfer', details: {
    old_owner: T, real_old_owner: A, is_purchase: true, payout_amount: '5000000000',
  } }, A)
  assert.match(text, /^📤 <b>Sold · /)
  assert.match(text, /Seller payout: 5 GRAM/)
})

test('notifications show a short quote without mutating references or implying a purchase', () => {
  const comment = '90 Telegram Stars Ref#example123'
  const action = { type: 'ton_transfer', success: true, transactions: ['test/hash'], details: {
    source: A, destination: T, value: '919800000', comment,
  } }
  const output = formatNotification(action, A, { tag: 'Main wallet' })
  assert.match(plain(output.text).split('\n')[0], /^📤 −0.9198 GRAM/)
  assert.match(output.richHtml, /^<p><tg-emoji emoji-id="5372989093565189720">📤<\/tg-emoji>/)
  assert.match(output.text, /<i>“90 Telegram Stars”<\/i>/)
  assert.equal(action.details.comment, comment)
  assert.match(output.richHtml, /<i>“90 Telegram Stars”<\/i>/)
  assert(!output.text.includes('Bought'))
  assert(output.text.includes('test%2Fhash'))
  assert.equal(output.text.split('\n').length, 3)
  action.details.comment = '<b>Untrusted</b> '.repeat(10)
  assert(formatNotification(action, A).text.includes('&lt;b&gt;Untrusted&lt;/b&gt;'))
  assert(formatNotification(action, A).richHtml.includes('&lt;b&gt;Untrusted&lt;/b&gt;'))
  action.details.encrypted = true
  assert(!formatNotification(action, A).text.includes('Untrusted'))
  assert(!formatNotification(action, A).richHtml.includes('Untrusted'))
})

test('every event uses one inline tx button with the same destination as its plain fallback', () => {
  for (const type of ['ton_transfer', 'jetton_transfer', 'nft_transfer', 'jetton_swap', 'jetton_mint',
    'jetton_burn', 'nft_mint', 'stake_deposit', 'raw_message', 'unknown']) {
    const action = { type, transactions: ['hash/+="<&'], trace_id: 'another-hash', details: {} }
    const output = formatNotification(action, A)
    const url = `https://tonscan.org/transaction/${encodeURIComponent(action.transactions[0])}`
    assert(output.richHtml.includes(`<tg-button type="url" url="${url}">tx</tg-button>`))
    assert(output.text.includes(`<a href="${url}">tx</a>`))
    assert.equal((output.richHtml.match(/<tg-button /g) || []).length, 1)
    assert.equal((output.richHtml.match(/<p>/g) || []).length, 1)
    assert(!output.richHtml.includes('another-hash'))
    assert(!/<(?:details|footer|table|tg-button-row)\b/.test(output.richHtml))
  }
  const action = { type: 'ton_transfer', details: {}, trace_id: 'trace/hash' }
  assert(formatNotification(action, A).richHtml.includes('trace%2Fhash'))
  delete action.trace_id
  const missingHash = formatNotification(action, A)
  assert.equal(missingHash.richHtml, undefined)
  assert(!missingHash.text.includes('/transaction/'))
})

test('display amounts preserve all significant digits without approximation', () => {
  assert.equal(formatDisplayUnits('520729196'), '0.520729196')
  assert.equal(formatDisplayUnits('999999999'), '0.999999999')
  assert.equal(formatDisplayUnits('1'), '0.000000001')
  assert.equal(formatDisplayUnits('12345', 18), '0.000000000000012345')
  assert.equal(formatDisplayUnits('123456789123456789'), '123,456,789.123456789')
  assert.equal(formatDisplayUnits('25000000', 6), '25')
})

test('asset icons distinguish native GRAM and the official USDt master from ticker lookalikes', () => {
  const usdt = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
  const action = { type: 'jetton_transfer', transactions: ['hash'], details: {
    sender: A, receiver: T, asset: usdt, amount: '1250000',
  } }
  const output = formatNotification(action, A, null, { [usdt]: metadata[T] })
  assert.match(output.richHtml, /<tg-emoji emoji-id="5406841020769936275">💵<\/tg-emoji> −1.25 <a/)
  assert.match(plain(output.text), /1.25 USDT/)
  assert(!output.text.includes('tg-emoji'))
  action.details.asset = T
  const lookalike = formatNotification(action, A, null, metadata)
  assert.match(plain(lookalike.text), /1.25 USDT/)
  assert(!lookalike.richHtml.includes('5406841020769936275'))
  assert(!lookalike.richHtml.includes('5318901904686754959'))
  const native = formatNotification({ type: 'ton_transfer', transactions: ['hash'], details: {
    source: A, destination: T, value: '510000000',
  } }, A)
  assert.match(native.richHtml, /<tg-emoji emoji-id="5318901904686754959">💎<\/tg-emoji> −0.51 GRAM/)
  assert.match(plain(native.text), /−0.51 GRAM/)
})

test('failed and self transfers never imply a successful balance change', () => {
  const action = { type: 'ton_transfer', success: false, details: { source: A, destination: T, value: '1000000000' } }
  const failed = plain(formatNotification(action, A).text)
  assert.match(failed, /^⚠️ Transfer failed · 1 GRAM/)
  assert(!failed.includes('−1 GRAM'))
  action.success = true; action.details.destination = A
  const self = plain(formatNotification(action, A).text)
  assert.match(self, /^🔁 1 GRAM/)
  assert.match(self, /Self/)
})

test('failed swaps and NFT purchases do not describe output or payout as completed', () => {
  const failedSwap = formatNotification({ type: 'jetton_swap', success: false, transactions: ['hash'], details: {
    sender: A, dex: 'stonfi_v2', dex_incoming_transfer: { asset: null, amount: '1000000000' },
    dex_outgoing_transfer: { asset: T, amount: '2000000' },
  } }, A, null, metadata)
  assert.match(plain(failedSwap.text), /^⚠️ Swap failed · 1 GRAM/)
  assert(!failedSwap.text.includes('USDT'))
  assert(!failedSwap.text.includes('→'))
  assert.match(failedSwap.richHtml, /^<p><tg-emoji emoji-id="5370640017037218875">/)
  const nft = { type: 'nft_transfer', success: false, transactions: ['hash'], details: {
    real_old_owner: A, new_owner: T, nft_item: T, is_purchase: true, payout_amount: '5000000000',
  } }
  const failedNft = formatNotification(nft, A)
  assert(!failedNft.text.includes('Sold'))
  assert(!failedNft.text.includes('payout'))
  const namedNft = formatNotification({ ...nft, success: true, details: { ...nft.details, is_purchase: false } }, A,
    null, { [T]: { token_info: [{ name: 'Example #42' }] } })
  assert.match(plain(namedNft.text), /^📤 NFT · Example #42/)
})
