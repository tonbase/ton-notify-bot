const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

// Always use our own disposable local database, regardless of .env settings.
const databaseName = `ton-notify-delivery-smoke-${randomUUID()}`
const uri = `mongodb://127.0.0.1:27018/${databaseName}`
process.env.MONGODB_URI = uri
process.env.NOTIFICATIONS_CHANNEL_ID = ''
process.env.SEND_NOTIFICATIONS = 'false'

const { mongoose, Address, User, Delivery, Counter } = require('../src/models')
const { loadWatched, routeEntries } = require('../src/notification-router')
const { ensureDeliveryIndexes } = require('../src/delivery-queue')
const { loadDeliveryState, DELIVERY_COOLDOWN_NAME } = require('../src/delivery-state')
const { sendPendingParallel } = require('../src/delivery')
const { createTelegramSender } = require('../src/telegram-sender')
const { readDeliveryMetrics, evaluateHealth } = require('../src/health')

const connectionOptions = { serverSelectionTimeoutMS: 5000, autoIndex: false }
const immediateLimiter = { run: (operation) => operation() }
const sendOptions = { maxMessages: 1, batchSize: 3, concurrency: 1 }

function healthSnapshot(database, now) {
  return {
    workers: {
      scanner: { status: 'ok', updatedAt: new Date(now).toISOString(), lag: 0 },
      delivery: { status: 'ok', updatedAt: new Date(now).toISOString(), sent: 0 },
    },
    disk: { available: true, freeBytes: 10 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 },
    database: { ...database, available: true },
  }
}

async function main() {
  let ownsDatabase = false
  try {
    await mongoose.connect(uri, connectionOptions)
    assert.equal(await mongoose.connection.db.listCollections().hasNext(), false, 'Smoke database must start empty')
    ownsDatabase = true
    await ensureDeliveryIndexes()
    const indexes = await Delivery.collection.indexes()
    assert(indexes.some((index) => index.key.status === 1 && index.key.sent_at === -1), 'Sent-time index is required')

    const wallet = `0:${'A'.repeat(64)}`
    const destination = `0:${'B'.repeat(64)}`
    const userId = 900001
    await User.create({ user_id: userId, first_name: 'Delivery smoke' })
    const subscription = await Address.create({ user_id: userId, address: wallet, tag: 'Smoke wallet' })
    const watched = await loadWatched()
    const entry = (number) => ({ action: {
      action_id: `smoke-action-${number}`, type: 'ton_transfer', success: true,
      transactions: [`smoke-transaction-${number}`],
      details: { source: wallet, destination, value: String(number * 1000000000) },
    } })
    const batch = [1, 2, 3].map(entry)
    await routeEntries(batch, watched)
    await routeEntries(batch, watched)
    assert.equal(await Delivery.countDocuments(), 3, 'Replaying routed events must preserve their durable identities')
    const queued = await Delivery.find({ status: 'pending' }).lean()
    const accepted = []
    const api = { sendMessage: async (chatId, text) => {
      assert.equal(chatId, userId)
      accepted.push(text)
      return { message_id: accepted.length }
    } }
    let state = await loadDeliveryState()
    let sender = createTelegramSender(api, state, { limiter: immediateLimiter })
    assert.equal(await sendPendingParallel(sender, state, sendOptions), 1)
    assert.equal(accepted.length, 1, 'Three events should share one accepted Telegram message')
    for (const delivery of queued) assert(accepted[0].includes(delivery.text), 'Every queued event must survive grouping')
    assert.equal(await Delivery.countDocuments({ status: 'sent' }), 3)
    assert.equal((await Address.findById(subscription._id)).counters.send_coins, 3)
    console.log('PASS real event routing, duplicate replay, grouped delivery and durable acknowledgments')

    await routeEntries([entry(4)], watched)
    state = await loadDeliveryState()
    sender = createTelegramSender(api, state, { limiter: immediateLimiter })
    const originalUpdate = Delivery.updateOne
    let failedAcknowledgment = false
    try {
      Delivery.updateOne = function (filter, update, ...options) {
        if (!failedAcknowledgment && update.$set?.status === 'sent') {
          failedAcknowledgment = true
          throw new Error('Simulated delivery acknowledgment failure')
        }
        return originalUpdate.call(this, filter, update, ...options)
      }
      await assert.rejects(sendPendingParallel(sender, state, sendOptions), /Simulated delivery acknowledgment failure/)
    } finally { Delivery.updateOne = originalUpdate }
    assert.equal(failedAcknowledgment, true)
    assert.equal(accepted.length, 2)
    assert.equal((await Delivery.findOne({ action_id: 'smoke-action-4' })).status, 'sending')
    assert.equal(state.accepted.size, 1)
    assert.equal(await sendPendingParallel(sender, state, sendOptions), 0)
    assert.equal(accepted.length, 2, 'Acknowledgment recovery must not resend an accepted message')
    assert.equal(state.accepted.size, 0)
    assert.equal(await Delivery.countDocuments({ status: 'sent' }), 4)
    assert.equal((await Address.findById(subscription._id)).counters.send_coins, 4)
    console.log('PASS database acknowledgment failure recovers on the next cycle without resending')

    await routeEntries([entry(5)], watched)
    state = await loadDeliveryState()
    let rejectedCalls = 0
    const limitedApi = { sendMessage: async () => {
      rejectedCalls += 1
      throw { error_code: 429, description: 'Smoke flood wait', parameters: { retry_after: 55225 } }
    } }
    sender = createTelegramSender(limitedApi, state, { limiter: immediateLimiter })
    const originalError = console.error
    const retryLogs = []
    try {
      console.error = (...args) => retryLogs.push(args.join(' '))
      assert.equal(await sendPendingParallel(sender, state, sendOptions), 0)
    } finally { console.error = originalError }
    assert.equal(rejectedCalls, 1)
    assert(retryLogs.some((line) => line.includes('55225s')))
    const persisted = await Counter.findOne({ name: DELIVERY_COOLDOWN_NAME }).lean()
    assert(persisted.data.untilMs > Date.now() + 55224000)
    await mongoose.disconnect()
    await mongoose.connect(uri, connectionOptions)
    state = await loadDeliveryState()
    assert.equal(state.cooldownUntil, persisted.data.untilMs)
    sender = createTelegramSender(limitedApi, state, { limiter: immediateLimiter })
    assert.equal(await sendPendingParallel(sender, state, sendOptions), 0)
    assert.equal(rejectedCalls, 1, 'A restarted worker must respect the persisted flood wait')
    console.log('PASS Telegram cooldown persists across a database reconnect and worker restart')

    const now = Date.now()
    const old = new Date(now - 13 * 60 * 60 * 1000)
    await Delivery.updateMany({ status: 'sent' }, { $set: { sent_at: old } })
    await Delivery.updateMany({ status: 'pending' }, { $set: { created_at: old } })
    const incidentMetrics = await readDeliveryMetrics({ Delivery, Counter })
    const incident = evaluateHealth(healthSnapshot(incidentMetrics, now), { now })
    assert.equal(incident.healthy, false)
    assert.equal(incident.checks.find((check) => check.name === 'delivery-heartbeat').healthy, true)
    assert.deepEqual(incident.checks.find((check) => check.name === 'delivery').issues,
      ['telegram_rate_limited', 'backlog_too_old', 'delivery_stalled'])

    // Advance only fixture state; never wait for or bypass a real Telegram ban.
    await Counter.updateOne({ name: DELIVERY_COOLDOWN_NAME }, { $set: { 'data.untilMs': 0 } })
    await Delivery.updateMany({ status: 'pending' }, { $set: { next_attempt_at: new Date(0) } })
    state = await loadDeliveryState()
    sender = createTelegramSender(api, state, { limiter: immediateLimiter })
    assert.equal(await sendPendingParallel(sender, state, sendOptions), 1)
    assert.equal(accepted.length, 3)
    assert.equal(await Delivery.countDocuments(), 5)
    assert.equal(await Delivery.countDocuments({ status: 'sent' }), 5)
    const recoveredMetrics = await readDeliveryMetrics({ Delivery, Counter })
    const recoveredAt = Date.now()
    assert.equal(recoveredMetrics.pendingDeliveries, 0)
    assert.equal(evaluateHealth(healthSnapshot(recoveredMetrics, recoveredAt), { now: recoveredAt }).healthy, true)
    console.log('PASS indexed health checks detect stalled delivery and confirm recovery after the queue drains')
  } finally {
    try {
      if (ownsDatabase) {
        if (mongoose.connection.readyState !== 1) await mongoose.connect(uri, connectionOptions)
        assert.equal(mongoose.connection.host, '127.0.0.1')
        assert.equal(mongoose.connection.port, 27018)
        assert.equal(mongoose.connection.name, databaseName)
        assert.match(databaseName, /^ton-notify-delivery-smoke-[0-9a-f-]{36}$/)
        await mongoose.connection.dropDatabase()
      }
    } finally { await mongoose.disconnect() }
  }
  console.log('PASS isolated delivery smoke; disposable database removed')
}

main().catch((error) => { console.error(`Delivery smoke failed: ${error.message}`); process.exitCode = 1 })
