const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

const databaseName = `ton-notify-digest-smoke-${randomUUID()}`
process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${databaseName}`
process.env.HOT_DIGEST_ADDRESSES = `0:${'A'.repeat(64)}`
process.env.HOT_DIGEST_CUTOVER_UTIME = '0'
process.env.DIGEST_THRESHOLD_PER_15M = '2'
process.env.NOTIFICATIONS_CHANNEL_ID = ''
process.env.SEND_NOTIFICATIONS = 'false'

const { mongoose, Address, User, Delivery, DigestWindow, DigestEvent } = require('../src/models')
const { loadWatched, routeAction } = require('../src/notification-router')
const { ensureDeliveryIndexes } = require('../src/delivery-queue')
const { ensureDigestIndexes, WINDOW_MS, loadDigestContents, prepareDigest } = require('../src/digest')
const { showDigest } = require('../src/bot/digests')
const { sendPendingParallel } = require('../src/delivery')

const A = `0:${'A'.repeat(64)}`
const B = `0:${'B'.repeat(64)}`
const C = `0:${'C'.repeat(64)}`
const closedWindow = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS - 2 * WINDOW_MS
const utime = Math.floor((closedWindow + 1000) / 1000)
const action = (id, source) => ({ action_id: id, start_utime: utime,
  type: 'ton_transfer', success: true, transactions: [`smoke-${id}`], details: { source, destination: C, value: '1000000000' } })

async function main() {
  let ownsDatabase = false
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false })
    assert.equal(await mongoose.connection.db.listCollections().hasNext(), false)
    ownsDatabase = true
    await ensureDeliveryIndexes()
    await ensureDigestIndexes()
    await User.create([{ user_id: 1001, first_name: 'Digest smoke' },
      { user_id: 1002, first_name: 'Volume smoke' }])
    await Address.create([{ user_id: 1001, address: A, tag: 'Main wallet' }, { user_id: 1002, address: B },
      { user_id: 1001, address: C, tag: 'My receiver', notifications: { is_enabled: false } }])
    const watched = await loadWatched()
    for (const [i, id] of ['one', 'two', 'three'].entries()) {
      const transfer = action(id, A)
      transfer.details.value = `${i + 1}00000000${i === 2 ? '1' : '0'}`
      transfer.start_utime += i
      await routeAction(transfer, {}, watched)
    }
    await routeAction(action('one', A), {}, watched)
    let digests = await Delivery.find({ delivery_kind: 'digest' }).lean()
    assert.equal(digests.length, 1)
    assert.equal(digests[0].digest_count, 3)
    assert.equal(await Delivery.countDocuments({ action_id: { $exists: true } }), 0)
    assert.equal(await DigestEvent.countDocuments(), 3)
    const accepted = []
    const sent = await sendPendingParallel({ sendMessage: async (chat, text, options) => {
      accepted.push({ chat, text, options })
      return { message_id: accepted.length }
    } }, {}, { maxMessages: 1, concurrency: 1, batchSize: 10 })
    assert.equal(sent, 1)
    assert.equal(accepted.length, 1)
    assert.match(accepted[0].text, /3 events/)
    assert.match(accepted[0].text, /6\.000000001 GRAM/)
    assert.match(accepted[0].text, /Main wallet/)
    assert.match(accepted[0].text, /My receiver/)
    assert.equal(accepted[0].options.reply_markup.inline_keyboard[0][0].text, 'All operations')
    assert.equal((await Delivery.findById(digests[0]._id)).status, 'sent')
    const owned = await Delivery.findById(digests[0]._id).lean()
    const views = []
    const ctx = { from: { id: 1001 }, callbackQuery: { message: {} },
      editMessageText: async (text, options) => views.push({ text, options }),
      reply: async (text, options) => views.push({ text, options }) }
    await showDigest(ctx, owned.address_id, closedWindow / 1000, '0')
    assert.match(views.at(-1).text, /All operations/)
    assert.equal((views.at(-1).text.match(/>tx<\/a>/g) || []).length, 3)
    await showDigest({ ...ctx, from: { id: 1002 } }, owned.address_id, closedWindow / 1000, '0')
    assert.equal(views.at(-1).text, 'This summary is unavailable.')
    for (const id of ['first', 'second', 'third']) await routeAction(action(id, B), {}, watched)
    await routeAction(action('first', B), {}, watched)
    await routeAction(action('second', B), {}, watched)
    digests = await Delivery.find({ delivery_kind: 'digest' }).lean()
    assert.equal(digests.length, 2)
    const dynamic = digests.find((item) => item.chat_id === 1002)
    assert.equal(dynamic.digest_count, 1)
    assert.equal(await Delivery.countDocuments({ user_id: '1002', action_id: { $exists: true } }), 2)
    assert.equal(await DigestWindow.countDocuments(), 3)
    assert.equal(await DigestEvent.countDocuments(), 4)

    // Shared event snapshots are written once per account, while recipient
    // windows and tag resolution remain private to their owner.
    await User.create({ user_id: 1003, first_name: 'Other subscriber' })
    await Address.create({ user_id: 1003, address: A, tag: 'Another wallet' })
    const shared = { ...action('shared', A), start_utime: utime + WINDOW_MS / 1000 }
    const updatedWatched = await loadWatched()
    await routeAction(shared, {}, updatedWatched)
    assert.equal(await DigestEvent.countDocuments(), 5)
    const sharedDigests = await Delivery.find({ 'digest.window_start': new Date(closedWindow + WINDOW_MS), delivery_kind: 'digest' }).lean()
    assert.equal(sharedDigests.length, 2)
    assert(sharedDigests.every((item) => item.digest_count === 1))
    const other = sharedDigests.find((item) => item.chat_id === 1003)
    const otherSummary = await prepareDigest(other)
    assert.match(otherSummary.text, /Another wallet/)
    assert(!otherSummary.text.includes('My receiver'))

    // A failure after the event/window writes must recover without counting
    // or summing that action twice on replay.
    const recovered = { ...action('recovered', A), start_utime: shared.start_utime + 1 }
    const originalUpdate = Delivery.updateOne
    let failOnce = true
    Delivery.updateOne = function (...args) {
      if (failOnce) { failOnce = false; throw new Error('Injected queue write failure') }
      return originalUpdate.apply(this, args)
    }
    try { await assert.rejects(routeAction(recovered, {}, updatedWatched), /Injected queue write failure/) }
    finally { Delivery.updateOne = originalUpdate }
    await routeAction(recovered, {}, updatedWatched)
    await routeAction(recovered, {}, updatedWatched)
    for (const item of await Delivery.find({ 'digest.window_start': new Date(closedWindow + WINDOW_MS) }).lean()) {
      assert.equal(item.digest_count, 2)
      const detail = await loadDigestContents(item)
      assert(detail.complete)
      assert.equal(detail.events.length, 2)
      assert.match((await prepareDigest(item)).text, /2 GRAM/)
    }
    assert.equal(await DigestEvent.countDocuments(), 6)
    console.log('PASS real MongoDB digest deduplication, exact totals, shared snapshots, ownership, crash replay and mocked Telegram delivery')
  } finally {
    if (ownsDatabase) await mongoose.connection.dropDatabase()
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
