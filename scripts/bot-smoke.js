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
    const domainLookups = []
    const bot = createBot('123456:fake', botInfo, { resolveDomain: async (domain) => {
      domainLookups.push(domain)
      if (domain === 'fresh.grm') return { address: `0:${'B'.repeat(64)}`, kind: 'owner' }
      if (domain === '1kilo.grm') return { address: wallet, kind: 'owner' }
      if (domain === 'tele.grm') return { address: '0:E9794960FFBCBDB7976AAE93779FDE1A6DED18975C4CC134F40E4D43DA59EEBF', kind: 'wallet' }
      return domain === 'tolya.ton' ? { address: wallet, kind: 'wallet' } : null
    } })
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
    await Address.updateOne({ _id: id }, { $set: { tag: '' } })
    for (const domain of ['tolya.ton:tolya.ton', '1kilo.grm:1kilo.grm']) {
      await message(domain)
      assert.equal(await Address.countDocuments({ user_id: user.id }), 1)
      const expectedTag = domain.split(':')[1]
      assert.equal((await Address.findById(id)).tag, expectedTag)
      assert(calls.at(-1).payload.text.includes(`Here it is: ${expectedTag}`))
      await message(domain.split(':')[0])
      assert.equal((await Address.findById(id)).tag, expectedTag, 'a DNS name without :tag preserves the existing label')
      await callback(`edit_${id}`)
      await message('Test wallet')
    }
    assert.deepEqual(domainLookups, ['tolya.ton', 'tolya.ton', '1kilo.grm', '1kilo.grm'])
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
    await callback(`notify_dust_${id}_off`)
    assert.equal((await Address.findById(id)).notifications.filter_dust, false)
    assert.match(JSON.stringify(calls.at(-1).payload.reply_markup), /Hide small incoming: OFF/)
    await callback(`notify_dust_${id}_on`)
    assert.equal((await Address.findById(id)).notifications.filter_dust, true)
    assert.match(calls.at(-1).payload.text, /successful incoming GRAM transfers/)
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
    // Older subscriptions persisted notifications:false. Mongoose document
    // saves must not try to add nested settings to that scalar during edits.
    await Address.collection.updateOne({ _id: record._id }, { $set: { notifications: false } })
    await callback(`delete_${id}`)
    assert.equal((await Address.findById(id)).is_deleted, true)
    assert.match(calls.at(-1).payload.text, /was deleted/)
    assert.equal((await Address.collection.findOne({ _id: record._id })).notifications, false)
    await callback(`undo_${id}`)
    assert.equal((await Address.findById(id)).is_deleted, false)
    await callback(`edit_${id}`)
    await message('Legacy boolean tag')
    assert.equal((await Address.findById(id)).tag, 'Legacy boolean tag')
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
    await callback(`notify_dust_${other._id}_off`)
    assert.equal((await Address.findById(other._id)).notifications.filter_dust, true)
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
    await message('fresh.grm:DNS wallet')
    const dnsRecord = await Address.findOne({ user_id: user.id, tag: 'DNS wallet' })
    assert.equal(dnsRecord.address, TonAddress.parseRaw(`0:${'B'.repeat(64)}`).toString({ bounceable: false, urlSafe: true }))
    assert.match(calls.at(-1).payload.text, /fresh\.grm →/)
    assert.match(calls.at(-1).payload.text, /track the current domain owner/)
    await message('tele.grm:tele.grm')
    const teleRecord = await Address.findOne({ user_id: user.id, tag: 'tele.grm' })
    assert.equal(teleRecord.address, 'UQDpeUlg_7y9t5dqrpN3n94abe0Yl1xMwTT0Dk1D2lnuv5eu')
    assert.doesNotMatch(calls.at(-1).payload.text, /track the current domain owner/)
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
