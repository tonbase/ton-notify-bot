const test = require('node:test')
const assert = require('node:assert/strict')
const { TonUsdPrice, tonUsdPrice, REFRESH_MS } = require('../src/prices')
const { formatTonUsd } = require('../src/amount')
const { formatNotification } = require('../src/events')
const { routeAction } = require('../src/notification-router')
const { Delivery } = require('../src/models')
const { config } = require('../src/config')

const A = `0:${'A'.repeat(64)}`, B = `0:${'B'.repeat(64)}`
const plain = value => value.replace(/<[^>]*>/g, '')
const ticker = (ts, last = '2.125') => ({ code: '0', data: [{ instId: 'GRAM-USDT', last, ts: String(ts) }] })

test('price refresh is shared by concurrent callers and cached for a minute', async () => {
  let now = 1_800_000_000_000, calls = 0, release
  const feed = new TonUsdPrice({ now: () => now, fetch: async (url, options) => {
    calls += 1
    assert.equal(url, 'https://www.okx.com/api/v5/market/ticker?instId=GRAM-USDT')
    assert(options.signal instanceof AbortSignal)
    await new Promise(resolve => { release = resolve })
    return Response.json(ticker(now))
  } })
  assert.equal(feed.current(), null)
  const refreshes = [feed.refresh(), feed.refresh(), feed.refresh()]
  assert.equal(calls, 1)
  release()
  await Promise.all(refreshes)
  assert.equal(feed.current(), '2.125')
  await feed.refresh()
  assert.equal(calls, 1)
  now += REFRESH_MS
  const next = feed.refresh()
  release()
  await next
  assert.equal(calls, 2)
})

test('outage retains the last quote only until its exchange timestamp expires and later recovers', async () => {
  let now = 1_800_000_000_000, fail = false
  const feed = new TonUsdPrice({ now: () => now, fetch: async () => {
    if (fail) throw new TypeError('fetch failed')
    return Response.json(ticker(now))
  } })
  await feed.refresh()
  now += REFRESH_MS; fail = true
  await assert.rejects(feed.refresh(), /fetch failed/)
  assert.equal(feed.current(), '2.125')
  now += 4 * REFRESH_MS
  assert.equal(feed.current(), null)
  fail = false
  await feed.refresh()
  assert.equal(feed.current(), '2.125')
})

test('price errors, invalid rates, wrong instruments and stale timestamps are rejected', async () => {
  const now = 1_800_000_000_000
  const invalid = [
    { code: '50011', data: [] }, { code: '0', data: [] }, null,
    { ...ticker(now), code: '1' },
    ...['', '0', '-1', 'NaN', 'Infinity', 'Ratelimit exceed', '<b>2</b>', '1e500', '1.1234567890123', 2, null]
      .map(last => ({ code: '0', data: [{ instId: 'GRAM-USDT', last, ts: String(now) }] })),
    ticker(now - 5 * REFRESH_MS), ticker(now + 60_001), ticker('invalid'), ticker(null),
    { code: '0', data: [{ ...ticker(now).data[0], instId: 'BTC-USDT' }] },
  ]
  for (const body of invalid) {
    const feed = new TonUsdPrice({ now: () => now, fetch: async () => Response.json(body) })
    await assert.rejects(feed.refresh(), /Invalid or stale/)
    assert.equal(feed.current(), null)
  }
  const limited = new TonUsdPrice({ fetch: async () => new Response('rate limited', { status: 429 }) })
  await assert.rejects(limited.refresh(), /HTTP 429/)
  const malformed = new TonUsdPrice({ fetch: async () => new Response('not JSON') })
  await assert.rejects(malformed.refresh())
  assert.equal(malformed.current(), null)
})

test('a hanging price request is aborted at its deadline', async () => {
  const feed = new TonUsdPrice({ timeoutMs: 10, fetch: (_url, { signal }) => new Promise((resolve, reject) => {
    const hold = setTimeout(() => assert.fail('price request did not time out'), 1000)
    signal.addEventListener('abort', () => { clearTimeout(hold); reject(signal.reason) }, { once: true })
  }) })
  await assert.rejects(feed.refresh(), { name: 'TimeoutError' })
  assert.equal(feed.current(), null)
})

test('USD estimates round cents precisely without rounding the original native amount', () => {
  assert.equal(formatTonUsd('12345000000', '2'), '$24.69')
  assert.equal(formatTonUsd('1000000000', '2.125'), '$2.13')
  assert.equal(formatTonUsd('1000000000', '2.124999999999'), '$2.12')
  assert.equal(formatTonUsd('1', '2'), '<$0.01')
  assert.equal(formatTonUsd('0', '2'), '$0.00')
  assert.equal(formatTonUsd('123456789012345678901234567890', '1'), '$123,456,789,012,345,678,901.23')
  for (const price of [null, undefined, '', '0', '-1', 'NaN', 'Infinity', 'Ratelimit exceed']) {
    assert.equal(formatTonUsd('1000000000', price), '')
  }
  for (const value of [null, undefined, '', '-1', '1.1', 'NaN', '<b>1</b>']) {
    assert.equal(formatTonUsd(value, '2'), '')
  }
})

test('USD is present in rich and fallback amounts, with exact quantity and correct direction', () => {
  const action = { type: 'ton_transfer', transactions: ['hash'], details: {
    source: A, destination: B, value: '12345000000',
  } }
  for (const [watched, sign] of [[A, '−'], [B, '+']]) {
    const output = formatNotification(action, watched, null, {}, undefined, '2')
    for (const text of [output.text, output.richHtml]) {
      assert(plain(text).includes(`${sign}12.345 GRAM (≈ $24.69)`))
    }
  }
  const missing = formatNotification(action, A)
  assert(!missing.text.includes('$'))
  assert(!missing.richHtml.includes('$'))
  const failed = formatNotification({ ...action, success: false }, A, null, {}, undefined, '2')
  assert(plain(failed.text).includes('Transfer failed · 12.345 GRAM (≈ $24.69)'))
  assert(!failed.text.includes('−12.345'))
  action.details.value = '1'
  for (const text of Object.values(formatNotification(action, A, null, {}, undefined, '2'))) {
    assert(text.includes('0.000000001 GRAM (≈ &lt;$0.01)'))
  }
})

test('native swap legs, staking and NFT prices receive USD estimates without valuing unrelated jettons', () => {
  const metadata = { [B]: { token_info: [{ symbol: 'TEST', extra: { decimals: '6' } }] } }
  const swap = { type: 'jetton_swap', transactions: ['hash'], details: {
    sender: A, dex_incoming_transfer: { amount: '1000000000', asset: null },
    dex_outgoing_transfer: { amount: '2000000', asset: B },
  } }
  const output = formatNotification(swap, A, null, metadata, undefined, '2')
  for (const text of [output.text, output.richHtml]) {
    assert(plain(text).includes('1 GRAM (≈ $2.00)'))
    assert(plain(text).includes('2 TEST'))
    assert.equal((text.match(/\$/g) || []).length, 1)
  }
  const failed = formatNotification({ ...swap, success: false }, A, null, metadata, undefined, '2')
  assert(!failed.text.includes('TEST'))
  assert(failed.text.includes('$2.00'))
  for (const type of ['stake_deposit', 'stake_withdrawal', 'auction_bid', 'election_deposit']) {
    assert(formatNotification({ type, details: { amount: '2000000000' } }, A, null, {}, undefined, '2').text.includes('$4.00'))
  }
  const nft = { type: 'nft_transfer', transactions: ['hash'], details: {
    real_old_owner: A, new_owner: B, nft_item: B, is_purchase: true,
    price: '6000000000', payout_amount: '5000000000',
  } }
  assert(plain(formatNotification(nft, A, null, {}, undefined, '2').text).includes('Seller payout: 5 GRAM (≈ $10.00)'))
  assert(plain(formatNotification(nft, B, null, {}, undefined, '2').text).includes('Price: 6 GRAM (≈ $12.00)'))
  assert(!formatNotification({ ...nft, success: false }, A, null, {}, undefined, '2').text.includes('$'))
})

test('routing stores a single cached rate in both private fanout and channel deliveries without price I/O', async t => {
  const records = [1, 2].map(id => ({ _id: String(id), user_id: id, address: A,
    notifications: { is_enabled: true } }))
  const watched = { map: new Map([[A, records]]), active: new Set([1, 2]) }
  const saved = [], previousChannel = config.channelId, previousMinimum = config.minChannelTon
  let reads = 0
  t.mock.method(tonUsdPrice, 'current', () => { reads += 1; return '2' })
  t.mock.method(tonUsdPrice, 'refresh', () => assert.fail('routing must not fetch prices'))
  t.mock.method(Delivery, 'find', () => ({ select: () => ({ lean: async () => [] }) }))
  t.mock.method(Delivery, 'bulkWrite', async operations => { saved.push(...operations.map(op => op.updateOne.update.$setOnInsert)) })
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => { saved.push(update.$setOnInsert) })
  config.channelId = '-100123'; config.minChannelTon = '1'
  try {
    const action = { action_id: 'usd-transfer', type: 'ton_transfer', transactions: ['hash'],
      details: { source: A, destination: B, value: '12345000000' } }
    await routeAction(action, {}, watched)
    assert.equal(reads, 1)
    assert.equal(saved.length, 3)
    assert(saved.some(row => row.chat_type === 'channel'))
    for (const row of saved) {
      assert(plain(row.text).includes('12.345 GRAM (≈ $24.69)'))
      assert(plain(row.rich_html).includes('12.345 GRAM (≈ $24.69)'))
    }
    watched.map.set(A, [records[0]])
    await routeAction({ ...action, action_id: 'single' }, {}, watched)
    assert.equal(saved.length, 5)
    assert(plain(saved[3].text).includes('12.345 GRAM (≈ $24.69)'))
  } finally { config.channelId = previousChannel; config.minChannelTon = previousMinimum }
})
