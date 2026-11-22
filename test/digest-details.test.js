const test = require('node:test')
const assert = require('node:assert/strict')
const { snapshotEvent, collectTotals, renderSummary, renderDigestPage, summaryKeyboard } = require('../src/digest-format')
const { loadDigestContents, prepareDigest, saveDigestEvent } = require('../src/digest')
const { DigestWindow, DigestEvent, Address, Delivery } = require('../src/models')
const { showDigest } = require('../src/bot/digests')
const { reply } = require('../src/bot/views')
const { sendBatch } = require('../src/telegram-sender')

const A = `0:${'A'.repeat(64)}`, B = `0:${'B'.repeat(64)}`, TOKEN = `0:${'C'.repeat(64)}`
const SUB = 'a'.repeat(24)
const start = Date.parse('2026-10-03T06:45:00Z')
const digest = { _id: 'digest', chat_id: 123, user_id: '123', address_id: SUB, digest_count: 3,
  digest: { address: A, window_start: new Date(start), window_end: new Date(start + 900000), format_version: 2 } }
const action = (id, details = {}, type = 'ton_transfer', success = true) => ({ action_id: id, type, success,
  start_utime: start / 1000 + 60, transactions: [`hash-${id}`], details: { source: A, destination: B, value: '1000000000', ...details } })
const event = (id, details, type, success) => ({ _id: id, ...snapshotEvent(action(id, details, type, success), A) })
const contents = (events) => ({ complete: true, events, labels: new Map([[A, 'Main <wallet>'], [B, 'My receiver']]), tag: 'Main <wallet>' })

test('digest totals preserve precision and separate failed, self, swap and NFT actions', () => {
  const events = [event('one', { value: '9007199254740993001' }), event('two', { value: '9' }),
    event('in', { source: B, destination: A, value: '1000000002' }),
    event('failed', { value: '999999999999999999999' }, 'ton_transfer', false),
    event('self', { destination: A }), event('swap', {}, 'jetton_swap'), event('nft', {}, 'nft_transfer')]
  const totals = collectTotals(events)
  assert.equal(totals.totals.out.get('native').sum, 9007199254740993010n)
  assert.deepEqual(totals.counts, { out: 2, in: 1, self: 1, swaps: 1, nft: 1, failed: 1, other: 0 })
  const text = renderSummary(digest, contents(events))
  assert.match(text, /9,007,199,254\.74099301 GRAM/u)
  assert.match(text, /1\.000000002 GRAM/u)
  assert.match(text, /Main &lt;wallet&gt;/u)
  assert.match(text, /My receiver/u)
  assert.match(text, /1 swap.*1 NFT.*1 failed.*1 self transfer/u)
  assert(!text.includes('999,999,999,999'))
})

test('jetton totals use metadata decimals and never merge contracts sharing a ticker', () => {
  const metadata = { [TOKEN]: { token_info: [{ valid: true, symbol: 'USDt', extra: { decimals: '6' } }] },
    [B]: { token_info: [{ valid: true, symbol: 'USDt', extra: { decimals: '9' } }] } }
  const events = [snapshotEvent(action('a', { asset: TOKEN, amount: '1234567' }, 'jetton_transfer'), A, metadata),
    snapshotEvent(action('b', { asset: B, amount: '9000000000' }, 'jetton_transfer'), A, metadata),
    snapshotEvent(action('unknown', { asset: TOKEN, amount: '1000000' }, 'jetton_transfer'), A)]
  const totals = collectTotals(events).totals.out
  assert.equal(totals.size, 2)
  assert.equal(totals.get(TOKEN).sum, 1234567n)
  assert(totals.get(TOKEN).partial)
  const text = renderSummary(digest, contents(events))
  assert.match(text, /1\.234567 \+ \?/u)
  assert.match(text, /9 <a /u)
  assert.match(text, /USDt \(UQ/u)
  assert.match(text, /amount unavailable/u)
})

test('latest sends are ordered by time and capped at five with all operations paginated', () => {
  const events = Array.from({ length: 40 }, (_, i) => ({ ...event(String(i)), utime: start / 1000 + i }))
  const text = renderSummary(digest, contents(events))
  assert.equal((text.match(/>tx<\/a>/gu) || []).length, 5)
  assert(text.indexOf('hash-39') < text.indexOf('hash-38'))
  assert.match(text, /35 more sends/u)
  const pages = []
  const first = renderDigestPage(digest, contents(events))
  for (let page = 0; page < first.pages; page++) pages.push(renderDigestPage(digest, contents(events), page))
  assert(first.pages > 1)
  assert.equal(pages.reduce((n, p) => n + (p.text.match(/>tx<\/a>/gu) || []).length, 0), 40)
  for (const p of pages) {
    assert(p.text.length < 3500)
    for (const row of p.reply_markup.inline_keyboard) for (const button of row) {
      if (button.callback_data) assert(Buffer.byteLength(button.callback_data) <= 64)
    }
  }
  assert.equal(renderDigestPage(digest, contents(events), 99999).page, first.pages - 1)
})

test('summary markup reaches Telegram fallback without altering event rendering', async () => {
  const markup = summaryKeyboard(digest, true)
  let calls = 0
  await sendBatch({ sendMessage: async (_chat, text, options) => {
    calls++
    assert.equal(text, 'Summary')
    assert.deepEqual(options.reply_markup, markup)
  } }, [{ ...digest, text: 'Summary', reply_markup: markup }], {}, '')
  assert.equal(calls, 1)
})

test('partial or expired event snapshots retain the count summary instead of incomplete totals', async (t) => {
  t.mock.method(DigestWindow, 'findById', () => ({ select: () => ({ lean: async () => ({ action_ids: ['one', 'two'] }) }) }))
  t.mock.method(DigestEvent, 'find', () => ({ lean: async () => [event('one')] }))
  assert.deepEqual(await loadDigestContents(digest), { complete: false })
  const prepared = await prepareDigest(digest)
  assert.match(prepared.text, /3 events/u)
  assert(!prepared.text.includes('Sent'))
  assert.equal(prepared.reply_markup.inline_keyboard[0].length, 1)
})

test('digest callback queries enforce recipient ownership before loading details', async (t) => {
  let query
  t.mock.method(Delivery, 'findOne', (filter) => {
    query = filter
    return { lean: async () => null }
  })
  const replies = []
  await showDigest({ from: { id: 999 }, reply: async (text) => replies.push(text) }, SUB, start / 1000, '0')
  assert.equal(query.user_id, '999')
  assert.equal(query.delivery_kind, 'digest')
  assert.equal(replies.length, 1)
  assert.match(replies[0], /unavailable/u)
})

test('event snapshot storage deduplicates races and propagates database failures', async (t) => {
  t.mock.method(DigestEvent, 'updateOne', async () => { throw { code: 11000 } })
  await saveDigestEvent(action('one'), A, {})
  t.mock.method(DigestEvent, 'updateOne', async () => { throw new Error('database offline') })
  await assert.rejects(saveDigestEvent(action('one'), A, {}), /database offline/u)
})

test('missing callback messages open a new view while ambiguous errors do not duplicate replies', async () => {
  let replies = 0
  const ctx = { callbackQuery: { message: {} }, editMessageText: async () => {
    throw { error_code: 400, description: 'Bad Request: MESSAGE_ID_INVALID' }
  }, reply: async () => { replies++ } }
  await reply(ctx, 'Summary details', null, true)
  assert.equal(replies, 1)
  ctx.editMessageText = async () => { throw new Error('network timeout') }
  await assert.rejects(reply(ctx, 'Summary details', null, true), /network timeout/u)
  assert.equal(replies, 1)
})
