const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Address: TonAddress } = require('@ton/core')
const { mongoose, Address, User, Session } = require('../src/models')
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
      const command = text.match(/^\/\w+(?:@\w+)?/)
      await bot.handleUpdate({ update_id: ++updateId, message: { message_id: updateId, date: 0, chat, from: user, text,
        ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command[0].length }] } : {}),
      } })
    }
    async function callback(data) {
      await bot.handleUpdate({ update_id: ++updateId, callback_query: {
        id: String(updateId), from: user, chat_instance: 'smoke', data,
        message: { message_id: 1, date: 0, chat, text: 'menu' },
      } })
    }
    const wallet = TonAddress.parseRaw(`0:${'A'.repeat(64)}`).toString({ bounceable: false, urlSafe: true })
    await message('/start')
    assert.match(calls.at(-1).payload.text, /Powered by @tonbase/)
    await message(`${wallet}:Test wallet`)
    let record = await Address.findOne({ user_id: user.id })
    assert.equal(record.tag, 'Test wallet')
    const id = String(record._id)
    // All representations open the same existing subscription and preserve
    // settings, rather than silently inserting another address row.
    for (const bounceable of [true, false]) for (const testOnly of [true, false]) for (const urlSafe of [true, false]) {
      const variant = TonAddress.parse(wallet).toString({ bounceable, testOnly, urlSafe })
      await message(`${variant}:replacement tag`)
      assert.equal(await Address.countDocuments({ user_id: user.id }), 1)
      assert.equal((await Address.findById(id)).tag, 'Test wallet')
      assert.match(calls.at(-1).payload.text, /Here it is/)
    }
    await message(TonAddress.parse(wallet).toRawString())
    assert.equal(await Address.countDocuments({ user_id: user.id }), 1)
    await message('/list')
    assert.match(calls.at(-1).payload.text, /Choose an address/)
    await callback(`open_${id}`)
    await callback(`notify_${id}_off`)
    record = await Address.findById(id)
    assert.equal(record.notifications.is_enabled, false)
    assert.match(JSON.stringify(calls.at(-1).payload.reply_markup), /Send notifications: No/)
    await callback(`notify_${id}_on`)
    await callback(`notify_min_amout_${id}`)
    await message('0.1')
    record = await Address.findById(id)
    assert.equal(String(record.notifications.min_amount), '100000000')
    await callback(`notify_min_amout_${id}`)
    await message('5000000000.000000001')
    assert.equal(String((await Address.findById(id)).notifications.min_amount), '100000000')
    await message('5e9')
    assert.equal(String((await Address.findById(id)).notifications.min_amount), '5000000000000000000')
    const sessionKey = { user_id: user.id, chat_id: user.id }
    const legacyScene = async (current, addressId = id) => Session.updateOne(sessionKey, {
      $set: { data: { __scenes: { current, state: { address_id: addressId } } } },
    })
    await legacyScene('editMinAmount')
    await callback('reset_min_amount')
    assert.equal(String((await Address.findById(id)).notifications.min_amount), '0')
    await legacyScene('editMinAmount')
    await message('.1')
    assert.equal(String((await Address.findById(id)).notifications.min_amount), '100000000')
    await callback(`notify_exceptions_${id}`)
    await message('+cashback, -ads')
    record = await Address.findById(id)
    assert.deepEqual(record.notifications.inclusion, ['cashback'])
    assert.deepEqual(record.notifications.exceptions, ['ads'])
    await legacyScene('editExceptions')
    await callback('clear_exceptions')
    record = await Address.findById(id)
    assert.deepEqual(record.notifications.inclusion, [])
    assert.deepEqual(record.notifications.exceptions, [])
    await legacyScene('editExceptions')
    await message('-')
    assert.deepEqual((await Address.findById(id)).notifications.exceptions, [''])
    await legacyScene('editTag')
    await message('Resumed legacy tag')
    assert.equal((await Address.findById(id)).tag, 'Resumed legacy tag')
    await callback(`edit_${id}`)
    await message('New tag')
    assert.equal((await Address.findById(id)).tag, 'New tag')
    await callback(`delete_${id}`)
    assert.equal((await Address.findById(id)).is_deleted, true)
    await callback(`undo_${id}`)
    assert.equal((await Address.findById(id)).is_deleted, false)
    await callback(`delete_${id}`)
    await message(wallet)
    assert.equal((await Address.findById(id)).tag, '', 're-adding without a tag clears the old tag')
    assert.equal((await Address.findById(id)).is_deleted, false)
    await legacyScene('editTag')
    await message(wallet)
    assert.equal((await Address.findById(id)).tag, '', 'an address cancels the edit flow')
    const other = await Address.create({ user_id: user.id + 1, address: wallet, tag: 'Other user' })
    await legacyScene('editTag', String(other._id))
    await message('Must not change')
    await callback(`delete_${other._id}`)
    assert.equal((await Address.findById(other._id)).tag, 'Other user')
    assert.equal((await Address.findById(other._id)).is_deleted, false)
    for (let index = 1; index <= 5; index++) await Address.create({ user_id: user.id, address: `0:${String(index).repeat(64)}` })
    await callback('list_1')
    assert.equal(calls.at(-1).payload.reply_markup.inline_keyboard[0][0].callback_data.startsWith('open_'), true)
    await callback(`open-list-${id}-0`)
    assert.match(calls.at(-1).payload.text, /Choose an address/)
    await message(`/start ${wallet}`)
    assert.match(calls.at(-1).payload.text, /Here it is/)
    await Address.collection.updateOne({ _id: record._id }, { $set: { notifications: false } })
    await callback(`notify_${id}`)
    assert.match(JSON.stringify(calls.at(-1).payload.reply_markup), /Send notifications: No/)
    await callback(`notify_min_amout_${id}`)
    await message('1')
    record = await Address.findById(id)
    assert.equal(record.notifications.is_enabled, false, 'editing a legacy false setting must not turn delivery on')
    assert.equal(String(record.notifications.min_amount), '1000000000')
    await callback(`notify_${id}_on`)
    record = await Address.findById(id)
    assert.equal(record.notifications.is_enabled, true)
    assert.equal(String(record.notifications.min_amount), '1000000000')
    await bot.handleUpdate({ update_id: ++updateId, inline_query: { id: 'share', from: user, query: wallet, offset: '' } })
    const inline = calls.find(({ method }) => method === 'answerInlineQuery')
    assert.equal(inline.payload.results[0].input_message_content.message_text, wallet)
    await bot.handleUpdate({ update_id: ++updateId, my_chat_member: { chat, from: user, date: 0,
      old_chat_member: { user: botInfo, status: 'member' }, new_chat_member: { user: botInfo, status: 'kicked' } } })
    assert.equal((await User.findOne({ user_id: user.id })).is_blocked, true)
    await message('/start')
    assert.equal((await User.findOne({ user_id: user.id })).is_blocked, false)
    assert(calls.some(({ method }) => method === 'answerCallbackQuery'))
    console.log(`PASS grammY add/list/settings/delete/undo/share/block recovery, legacy sessions/buttons, numeric input, equivalent addresses and ownership; ${calls.length} mocked Telegram API calls`)
  } finally {
    // Retain this uniquely named local test database for inspection.
    await mongoose.disconnect()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
