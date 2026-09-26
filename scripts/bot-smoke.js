const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Address: TonAddress } = require('@ton/core')
const { mongoose, Address } = require('../src/models')
const { createBot } = require('../src/bot')

async function main() {
  const name = `ton-notify-smoke-${randomUUID().slice(0, 8)}`
  await mongoose.connect(`mongodb://127.0.0.1:27018/${name}`, { serverSelectionTimeoutMS: 5000, autoIndex: false })
  try {
    const user = { id: 900001, is_bot: false, first_name: 'Smoke' }
    const chat = { id: user.id, type: 'private' }
    const botInfo = { id: 123456, is_bot: true, first_name: 'Test bot', username: 'test_notify_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: true }
    const bot = createBot('123456:fake', botInfo)
    const calls = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      if (method === 'sendMessage') return { ok: true, result: { message_id: calls.length, date: 0, chat, text: payload.text } }
      return { ok: true, result: true }
    })
    let updateId = 0
    async function message(text) {
      await bot.handleUpdate({ update_id: ++updateId, message: { message_id: updateId, date: 0, chat, from: user, text } })
    }
    async function callback(data) {
      await bot.handleUpdate({ update_id: ++updateId, callback_query: {
        id: String(updateId), from: user, chat_instance: 'smoke', data,
        message: { message_id: 1, date: 0, chat, text: 'menu' },
      } })
    }
    const wallet = TonAddress.parseRaw(`0:${'A'.repeat(64)}`).toString({ bounceable: false, urlSafe: true })
    await message('/start')
    await message(`${wallet}:Test wallet`)
    let record = await Address.findOne({ user_id: user.id })
    assert.equal(record.tag, 'Test wallet')
    const id = String(record._id)
    await message('/list')
    await callback(`open_${id}`)
    await callback(`notify_${id}_off`)
    record = await Address.findById(id)
    assert.equal(record.notifications.is_enabled, false)
    await callback(`notify_${id}_on`)
    await callback(`notify_min_amout_${id}`)
    await message('0.1')
    record = await Address.findById(id)
    assert.equal(String(record.notifications.min_amount), '100000000')
    await callback(`notify_exceptions_${id}`)
    await message('+cashback, -ads')
    record = await Address.findById(id)
    assert.deepEqual(record.notifications.inclusion, ['cashback'])
    assert.deepEqual(record.notifications.exceptions, ['ads'])
    await callback(`edit_${id}`)
    await message('New tag')
    assert.equal((await Address.findById(id)).tag, 'New tag')
    await callback(`delete_${id}`)
    assert.equal((await Address.findById(id)).is_deleted, true)
    await callback(`undo_${id}`)
    assert.equal((await Address.findById(id)).is_deleted, false)
    assert(calls.some(({ method }) => method === 'answerCallbackQuery'))
    console.log(`PASS grammY add/list/open/settings/tag/delete/undo; ${calls.length} mocked Telegram API calls`)
  } finally {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
