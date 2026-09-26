const test = require('node:test')
const assert = require('node:assert/strict')
const { createLab } = require('../scripts/design-lab')
const { REVISION } = require('../src/designs')

test('design votes and notes persist only for the registered owner; rich previews edit natively', async () => {
  const owner = { userId: 123, chatId: 123, botId: 456 }
  const state = { messages: { 10: { revision: REVISION, designId: 'e', caseId: 'usdt', mode: 'rich' } } }
  let saves = 0
  const calls = []
  const botInfo = { id: 456, is_bot: true, first_name: 'Design test', username: 'design_test_bot' }
  const { bot } = createLab(owner, state, () => { saves += 1 }, '456:fake', botInfo)
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload })
    return { ok: true, result: method === 'sendMessage' ? { message_id: 20 } : true }
  })
  let id = 0
  const callback = (userId, data) => bot.handleUpdate({ update_id: ++id, callback_query: {
    id: String(id), from: { id: userId, is_bot: false, first_name: 'Test' }, chat_instance: 'test', data,
    message: { message_id: 10, date: 0, chat: { id: userId, type: 'private' } },
  } })
  await callback(999, 'lab:vote:e:usdt:finalist')
  assert.equal(saves, 0)
  assert.equal(calls.length, 0)
  await callback(123, 'lab:vote:e:usdt:finalist')
  assert.equal(state.votes[`${REVISION}:e:usdt`].rating, 'finalist')
  assert(saves > 0)
  await callback(123, 'lab:case:e:nft')
  const edited = calls.find((call) => call.method === 'editMessageText')
  assert(edited.payload.rich_message.html.includes('<details>'))
  assert.equal(edited.payload.chat_id, owner.chatId)
  assert.equal(state.messages[10].caseId, 'nft')
  await bot.handleUpdate({ update_id: ++id, message: { message_id: 11, date: 0,
    chat: { id: 123, type: 'private' }, from: { id: 123, is_bot: false, first_name: 'Test' },
    text: 'Keep the amount larger', reply_to_message: { message_id: 10 },
  } })
  assert.equal(state.notes[0].designId, 'e')
  assert.equal(state.notes[0].caseId, 'nft')
  assert.equal(state.notes[0].text, 'Keep the amount larger')
})
