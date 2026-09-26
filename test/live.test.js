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
  assert.equal(calls, 0)
  await sender.sendMessage(123, 'test', {})
  assert.equal(calls, 1); assert.equal(persisted, 1)
  enabled = false
  await assert.rejects(() => sender.sendMessage(123, 'test', {}))
  assert.equal(calls, 1)
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
