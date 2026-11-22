const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateHealth, collectHealthSnapshot, readDeliveryMetrics } = require('../src/health')

const now = Date.parse('2026-09-27T14:04:00Z')
const minute = 60000

function snapshot() {
  return {
    workers: {
      scanner: { status: 'ok', updatedAt: new Date(now).toISOString(), lag: 0 },
      delivery: { status: 'ok', updatedAt: new Date(now).toISOString(), sent: 0 },
    },
    disk: { available: true, freeBytes: 10 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 },
    database: { available: true, pendingDeliveries: 0, oldestPendingAt: null, lastSentAt: null, cooldownUntil: 0 },
  }
}

function evaluate(state, options = {}) { return evaluateHealth(state, { now, ...options }) }
function component(result, name) { return result.checks.find((item) => item.name === name) }

test('live recovery health includes historical progress and fails closed when it is missing', () => {
  const state = snapshot()
  assert.equal(component(evaluate(state, { liveRecovery: true }), 'backfill').healthy, false)
  state.workers.backfill = { status: 'ok', updatedAt: new Date(now).toISOString(), lag: 2000000 }
  assert.deepEqual(component(evaluate(state, { liveRecovery: true }), 'backfill').issues, ['scanner_lag_exceeded'])
  state.workers.backfill.lag = 0
  assert.equal(evaluate(state, { liveRecovery: true }).healthy, true)
})

test('live worker heartbeat cannot hide the production Telegram flood wait and stalled million-row queue', () => {
  const state = snapshot()
  state.database = {
    available: true,
    pendingDeliveries: 1330000,
    oldestPendingAt: now - 13 * 60 * minute,
    lastSentAt: now - 13 * 60 * minute,
    cooldownUntil: now + 142 * minute,
  }
  const result = evaluate(state)
  assert.equal(result.healthy, false)
  assert.equal(component(result, 'delivery-heartbeat').healthy, true)
  assert.deepEqual(component(result, 'delivery').issues, ['telegram_rate_limited', 'backlog_too_old', 'delivery_stalled'])
  assert.equal(component(result, 'delivery').metrics.cooldownRemainingSeconds, 8520)
})

test('empty queue is healthy without any past sends, even during a remaining Telegram cooldown', () => {
  const state = snapshot()
  state.workers.delivery.status = 'rate_limited'
  state.database.cooldownUntil = now + 60 * minute
  assert.equal(evaluate(state).healthy, true)
})

test('fresh work has time to start and becomes unhealthy when it stalls', () => {
  const state = snapshot()
  state.database.pendingDeliveries = 1
  state.database.oldestPendingAt = now - minute
  assert.equal(evaluate(state).healthy, true)
  state.database.oldestPendingAt = now - 5 * minute
  assert.deepEqual(component(evaluate(state), 'delivery').issues, ['delivery_stalled'])
})

test('cooldown expiration alone does not mark a stalled sender recovered', () => {
  const state = snapshot()
  state.database.pendingDeliveries = 3
  state.database.oldestPendingAt = now - 6 * minute
  state.database.lastSentAt = now - 10 * minute
  state.database.cooldownUntil = now - 1
  assert.deepEqual(component(evaluate(state), 'delivery').issues, ['delivery_stalled'])
  state.database.lastSentAt = now - 1000
  assert.equal(evaluate(state).healthy, true)
})

test('recent sends do not hide an excessive delivery backlog', () => {
  const state = snapshot()
  state.database.pendingDeliveries = 10
  state.database.oldestPendingAt = now - 15 * minute
  state.database.lastSentAt = now - 1000
  assert.deepEqual(component(evaluate(state), 'delivery').issues, ['backlog_too_old'])
  state.database.oldestPendingAt = now - 4 * minute
  assert.equal(evaluate(state).healthy, true)
})

test('worker cooldown takes effect before the persisted state becomes visible', () => {
  const state = snapshot()
  state.database.pendingDeliveries = 1
  state.database.oldestPendingAt = now
  state.workers.delivery.cooldownUntil = now + minute
  state.workers.delivery.status = 'rate_limited'
  assert.deepEqual(component(evaluate(state), 'delivery').issues, ['telegram_rate_limited'])
})

test('fresh delivery progress in a worker snapshot can cover a database sampling race', () => {
  const state = snapshot()
  state.database.pendingDeliveries = 1
  state.database.oldestPendingAt = now - 6 * minute
  state.database.lastSentAt = now - 10 * minute
  state.workers.delivery.lastSentAt = new Date(now - 1000).toISOString()
  assert.equal(evaluate(state).healthy, true)
})

test('stale and missing worker heartbeats fail even with an empty queue', () => {
  const state = snapshot()
  state.workers.scanner.updatedAt = new Date(now - 2 * minute).toISOString()
  delete state.workers.delivery
  const result = evaluate(state)
  assert.equal(result.healthy, false)
  assert.deepEqual(component(result, 'scanner').issues, ['heartbeat_stale'])
  assert.deepEqual(component(result, 'delivery-heartbeat').issues, ['worker_missing', 'heartbeat_missing'])
})

test('scanner health requires known lag and rejects excessive lag', () => {
  const state = snapshot()
  delete state.workers.scanner.lag
  assert.deepEqual(component(evaluate(state), 'scanner').issues, ['scanner_lag_unknown'])
  state.workers.scanner.lag = 1001
  assert.deepEqual(component(evaluate(state), 'scanner').issues, ['scanner_lag_exceeded'])
})

test('a retrying worker cannot be masked by a recent successful iteration', () => {
  const state = snapshot()
  state.workers.delivery.status = 'retrying'
  state.workers.delivery.lastSuccessAt = new Date(now - 1000).toISOString()
  assert.deepEqual(component(evaluate(state), 'delivery-heartbeat').issues, ['worker_not_ready'])
})

test('disabled notifications do not require a delivery worker or delivery metrics', () => {
  const state = snapshot()
  delete state.workers.delivery
  state.database = { available: true }
  assert.equal(evaluate(state, { sendNotifications: false }).healthy, true)
})

test('database and disk failures are explicit and do not hide worker checks', () => {
  const state = snapshot()
  state.database = { available: false }
  state.disk = { available: false }
  const result = evaluate(state)
  assert.equal(result.healthy, false)
  assert.deepEqual(component(result, 'database').issues, ['database_unavailable'])
  assert.deepEqual(component(result, 'disk').issues, ['disk_unavailable'])
  assert.equal(component(result, 'scanner').healthy, true)
  assert.equal(component(result, 'delivery'), undefined)
})

test('disk checks enforce both absolute free space and free percentage', () => {
  const state = snapshot()
  state.disk.freeBytes = 0.9 * 1024 ** 3
  assert.deepEqual(component(evaluate(state), 'disk').issues, ['disk_space_low'])
  state.disk.freeBytes = 4 * 1024 ** 3
  assert.deepEqual(component(evaluate(state), 'disk').issues, ['disk_space_low'])
})

test('missing queue metadata cannot produce an all-clear', () => {
  const state = snapshot()
  state.database.pendingDeliveries = 1
  assert.deepEqual(component(evaluate(state), 'delivery').issues, ['backlog_age_unknown'])
  delete state.database.pendingDeliveries
  assert.deepEqual(component(evaluate(state), 'delivery').issues, ['queue_size_unknown'])
})

test('health output never echoes worker errors, chat identifiers or configuration secrets', () => {
  const state = snapshot()
  state.workers.delivery.error = 'secret-token chat_id=123456789'
  state.workers.delivery.chat_id = '123456789'
  state.database.mongoUri = 'mongodb://secret-password'
  assert.doesNotMatch(JSON.stringify(evaluate(state)), /secret|123456789|mongodb/)
})

test('snapshot collection isolates file, disk and database failures without leaking their errors', async () => {
  const state = await collectHealthSnapshot({
    directory: 'health', volume: '.',
    fileSystem: {
      readFile: async (file) => file.endsWith('scanner.json') ? JSON.stringify(snapshot().workers.scanner) : 'broken JSON',
      statfs: async () => { throw new Error('secret disk error') },
    },
    readDatabase: async () => { throw new Error('mongodb://secret-password') },
  })
  assert.equal(state.workers.scanner.lag, 0)
  assert.equal(state.workers.delivery.status, 'missing')
  assert.deepEqual(state.disk, { available: false })
  assert.deepEqual(state.database, { available: false })
  assert.doesNotMatch(JSON.stringify(state), /secret|mongodb/)
})

test('snapshot collection reads available volume space and omits disabled workers', async () => {
  const files = []
  const state = await collectHealthSnapshot({
    directory: 'health', volume: '.', sendNotifications: false,
    fileSystem: {
      readFile: async (file) => { files.push(file); return JSON.stringify(snapshot().workers.scanner) },
      statfs: async () => ({ bavail: 10n, bsize: 1024n ** 3n, blocks: 100n }),
    },
    readDatabase: async () => ({}),
  })
  assert.equal(files.length, 1)
  assert.equal(state.disk.freeBytes, 10 * 1024 ** 3)
  assert.equal(evaluate(state, { sendNotifications: false }).healthy, true)
})

test('database metrics include leased work and use bounded index reads with safe projections', async () => {
  const queries = []
  function query(value, kind) {
    const entry = { kind }
    queries.push(entry)
    return {
      sort(order) { entry.sort = order; return this },
      select(fields) { entry.select = fields; return this },
      hint(index) { entry.hint = index; return this },
      maxTimeMS(timeout) { entry.timeout = timeout; return this },
      lean: async () => value,
      then(resolve) { return Promise.resolve(value).then(resolve) },
    }
  }
  const Delivery = {
    countDocuments: () => query(12, 'count'),
    findOne: ({ status }) => query({
      pending: { created_at: new Date(now - minute) },
      sending: { created_at: new Date(now - 6 * minute) },
      sent: { sent_at: new Date(now - 1000) },
    }[status], status),
  }
  const Counter = { findOne: () => query({ data: { untilMs: now + minute } }, 'cooldown') }
  const result = await readDeliveryMetrics({ Delivery, Counter })
  assert.deepEqual(result, { pendingDeliveries: 12, oldestPendingAt: now - 6 * minute, lastSentAt: now - 1000, cooldownUntil: now + minute })
  for (const entry of queries) {
    assert.equal(entry.timeout, 5000)
    if (entry.kind !== 'cooldown') assert(entry.hint, `${entry.kind} must use an index`)
    if (entry.kind !== 'count') assert.equal(entry.select._id, 0)
  }
  assert.doesNotMatch(JSON.stringify(queries), /chat_id|text|last_error/)
})
