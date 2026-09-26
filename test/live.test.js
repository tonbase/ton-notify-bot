const test = require('node:test')
const assert = require('node:assert/strict')
const { privateSender } = require('../scripts/live-lab')
const { sendPending } = require('../src/scanner')
const { Delivery } = require('../src/models')

test('live delivery is restricted to the owner and stops before the next API call', async () => {
  let enabled = true, calls = 0, persisted = 0
  const owner = { userId: 123, chatId: 123, botId: 456 }
  const api = { sendMessage: async (chat, _text, options) => {
    assert.equal(chat, 123); assert.equal(options.disable_notification, true); calls += 1
    return { message_id: 7 }
  } }
  const sender = privateSender(api, owner, () => enabled, () => { persisted += 1 })
  await assert.rejects(() => sender.sendMessage(999, 'test', {}))
  await assert.rejects(() => sender.sendRichMessage(999, { html: '<p>test</p>' }, {}))
  assert.equal(calls, 0)
  await sender.sendMessage(123, 'test', {})
  assert.equal(calls, 1); assert.equal(persisted, 1)
  enabled = false
  await assert.rejects(() => sender.sendMessage(123, 'test', {}))
  assert.equal(calls, 1)
})

test('rich notifications use the native API and remain one durable delivery', async (t) => {
  const updates = []
  t.mock.method(Delivery, 'findOneAndUpdate', async () => ({ _id: 'rich', chat_id: 123,
    text: 'plain fallback', rich_html: '<p>summary</p><details><summary>Details</summary><p>extra</p></details>' }))
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => updates.push(update))
  let richCalls = 0
  const sender = privateSender({ sendRichMessage: async (chat, body, options) => {
    assert.equal(chat, 123); assert(body.html.includes('<details>')); assert(options.disable_notification)
    richCalls += 1; return { message_id: 8 }
  }, sendMessage: async () => { throw Error('Unexpected fallback') } }, { userId: 123, chatId: 123, botId: 456 }, () => true, () => {})
  assert.equal(await sendPending(sender, {}, { maxMessages: 1, chatId: 123 }), 1)
  assert.equal(richCalls, 1); assert.equal(updates[0].$set.status, 'sent')
})

test('live batches claim only the permitted chat and send one message', async (t) => {
  let claims = 0, calls = 0
  t.mock.method(Delivery, 'findOneAndUpdate', async (filter) => {
    assert.equal(filter.chat_id, 123); claims += 1
    return { _id: `d${claims}`, chat_id: 123, text: 'real event' }
  })
  t.mock.method(Delivery, 'updateOne', async () => {})
  const result = await sendPending({ sendMessage: async () => { calls += 1 } }, {}, { maxMessages: 1, chatId: 123 })
  assert.equal(result, 1); assert.equal(claims, 1); assert.equal(calls, 1)
})

test('an explicit rich rejection falls back once; ambiguous network failures never do', async (t) => {
  let remaining = 1
  t.mock.method(Delivery, 'findOneAndUpdate', async () => remaining-- > 0 ? { _id: 'rich', chat_id: 123, text: 'fallback', rich_html: '<p>rich</p>' } : null)
  t.mock.method(Delivery, 'updateOne', async () => {})
  t.mock.method(console, 'error', () => {})
  let plain = 0
  let error = { error_code: 400, description: 'Invalid rich message' }
  const api = { sendRichMessage: async () => { throw error }, sendMessage: async () => { plain += 1 } }
  assert.equal(await sendPending(api, {}, { maxMessages: 1 }), 1)
  assert.equal(plain, 1)
  remaining = 1
  error = { error_code: 429, parameters: { retry_after: 1 }, description: 'Too Many Requests' }
  assert.equal(await sendPending(api, {}, { maxMessages: 1 }), 0)
  assert.equal(plain, 1)
  remaining = 1
  error = new TypeError('network timeout after request')
  assert.equal(await sendPending(api, {}, { maxMessages: 1 }), 0)
  assert.equal(plain, 1)
})
