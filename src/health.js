const fs = require('node:fs/promises')
const path = require('node:path')

const HEALTH_LIMITS = Object.freeze({
  heartbeatMs: 120000,
  scannerLagBlocks: 1000,
  stalledDeliveryMs: 5 * 60000,
  backlogAgeMs: 15 * 60000,
  minimumFreeBytes: 1024 ** 3,
  minimumFreeRatio: 0.05,
})
const DELIVERY_COOLDOWN_NAME = 'telegram_delivery_cooldown_v1'
const QUEUE_INDEX = { status: 1, created_at: 1, next_attempt_at: 1 }
const SENT_INDEX = { status: 1, sent_at: -1 }

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const result = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(result) && result >= 0 ? result : null
}

function secondsSince(value, now) {
  const time = timestamp(value)
  return time === null ? null : Math.max(0, Math.floor((now - time) / 1000))
}

function check(name, issues, metrics = {}) {
  return { name, healthy: issues.length === 0, issues, metrics }
}

function workerCheck(name, state, now, limits) {
  const issues = []
  if (!state || state.status === 'missing') issues.push('worker_missing')
  else if (!(state.status === 'ok' || (name === 'delivery-heartbeat' && state.status === 'rate_limited'))) {
    issues.push('worker_not_ready')
  }
  const heartbeat = timestamp(state?.updatedAt || state?.lastSuccessAt)
  if (heartbeat === null) issues.push('heartbeat_missing')
  else if (now - heartbeat >= limits.heartbeatMs || heartbeat > now + limits.heartbeatMs) issues.push('heartbeat_stale')
  const metrics = { heartbeatAgeSeconds: secondsSince(heartbeat, now) }
  if (name === 'scanner' || name === 'backfill') {
    if (!Number.isFinite(state?.lag) || state.lag < 0) issues.push('scanner_lag_unknown')
    else {
      metrics.lagBlocks = state.lag
      if (state.lag > limits.scannerLagBlocks) issues.push('scanner_lag_exceeded')
    }
  }
  return check(name, issues, metrics)
}

// A successful worker iteration is a heartbeat. Delivery health additionally
// requires database evidence that waiting notifications are making progress.
function evaluateHealth(snapshot, { now = Date.now(), sendNotifications = true, liveRecovery = false, limits = {} } = {}) {
  const thresholds = { ...HEALTH_LIMITS, ...limits }
  const checks = [workerCheck('scanner', snapshot.workers?.scanner, now, thresholds)]
  if (liveRecovery) checks.push(workerCheck('backfill', snapshot.workers?.backfill, now, thresholds))
  if (sendNotifications) checks.push(workerCheck('delivery-heartbeat', snapshot.workers?.delivery, now, thresholds))

  const disk = snapshot.disk
  const diskIssues = []
  if (!disk?.available || !Number.isFinite(disk.freeBytes) || !Number.isFinite(disk.totalBytes) || disk.totalBytes <= 0) {
    diskIssues.push('disk_unavailable')
  } else if (disk.freeBytes < thresholds.minimumFreeBytes || disk.freeBytes / disk.totalBytes < thresholds.minimumFreeRatio) {
    diskIssues.push('disk_space_low')
  }
  checks.push(check('disk', diskIssues, disk?.available && Number.isFinite(disk.freeBytes)
    ? { freeGiB: Math.round(disk.freeBytes / 1024 ** 3 * 10) / 10 } : {}))

  const database = snapshot.database
  checks.push(check('database', database?.available ? [] : ['database_unavailable']))
  if (sendNotifications && database?.available) {
    const issues = []
    const pending = database.pendingDeliveries
    const oldestPendingAt = timestamp(database.oldestPendingAt)
    const lastSentAt = Math.max(timestamp(database.lastSentAt) || 0, timestamp(snapshot.workers?.delivery?.lastSentAt) || 0) || null
    const cooldownUntil = Math.max(timestamp(database.cooldownUntil) || 0, timestamp(snapshot.workers?.delivery?.cooldownUntil) || 0)
    if (!Number.isSafeInteger(pending) || pending < 0) issues.push('queue_size_unknown')
    else if (pending > 0) {
      if (cooldownUntil > now) issues.push('telegram_rate_limited')
      if (oldestPendingAt === null) issues.push('backlog_age_unknown')
      else {
        const age = now - oldestPendingAt
        if (age >= thresholds.backlogAgeMs) issues.push('backlog_too_old')
        if (age >= thresholds.stalledDeliveryMs && (lastSentAt === null || now - lastSentAt >= thresholds.stalledDeliveryMs)) {
          issues.push('delivery_stalled')
        }
      }
    }
    checks.push(check('delivery', issues, {
      pendingDeliveries: Number.isSafeInteger(pending) && pending >= 0 ? pending : null,
      oldestPendingAgeSeconds: secondsSince(oldestPendingAt, now),
      lastSentAgeSeconds: secondsSince(lastSentAt, now),
      cooldownRemainingSeconds: Math.max(0, Math.ceil((cooldownUntil - now) / 1000)),
    }))
  }
  return { healthy: checks.every((item) => item.healthy), checks }
}

// Projections exclude message contents and recipient identifiers. Explicit
// indexes and query deadlines keep this safe for large production queues.
async function readDeliveryMetrics({ Delivery, Counter, queryTimeoutMs = 5000 }) {
  const oldest = (status) => Delivery.findOne({ status }).sort({ created_at: 1 })
    .select({ created_at: 1, _id: 0 }).hint(QUEUE_INDEX).maxTimeMS(queryTimeoutMs).lean()
  const [pendingDeliveries, pending, sending, sent, cooldown] = await Promise.all([
    Delivery.countDocuments({ status: { $in: ['pending', 'sending'] } }).hint(QUEUE_INDEX).maxTimeMS(queryTimeoutMs),
    oldest('pending'),
    oldest('sending'),
    Delivery.findOne({ status: 'sent' }).sort({ sent_at: -1 }).select({ sent_at: 1, _id: 0 })
      .hint(SENT_INDEX).maxTimeMS(queryTimeoutMs).lean(),
    Counter.findOne({ name: DELIVERY_COOLDOWN_NAME }).select({ 'data.untilMs': 1, _id: 0 })
      .maxTimeMS(queryTimeoutMs).lean(),
  ])
  const pendingTimes = [pending, sending].filter(Boolean).map((item) => timestamp(item.created_at))
  return {
    pendingDeliveries,
    oldestPendingAt: pendingTimes.length && pendingTimes.every((time) => time !== null) ? Math.min(...pendingTimes) : null,
    lastSentAt: timestamp(sent?.sent_at),
    cooldownUntil: timestamp(cooldown?.data?.untilMs) || 0,
  }
}

async function collectHealthSnapshot({ directory, volume, readDatabase, sendNotifications = true, liveRecovery = false, fileSystem = fs }) {
  const names = ['scanner', ...(sendNotifications ? ['delivery'] : []), ...(liveRecovery ? ['backfill'] : [])]
  const [workers, disk, database] = await Promise.all([
    Promise.all(names.map(async (name) => {
      try { return [name, JSON.parse(await fileSystem.readFile(path.join(directory, `${name}.json`), 'utf8'))] }
      catch { return [name, { status: 'missing' }] }
    })).then(Object.fromEntries),
    (async () => {
      try {
        const stats = await fileSystem.statfs(volume)
        return { available: true, freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize) }
      } catch { return { available: false } }
    })(),
    (async () => {
      try { return { ...await readDatabase(), available: true } }
      catch { return { available: false } }
    })(),
  ])
  return { workers, disk, database }
}

module.exports = { HEALTH_LIMITS, evaluateHealth, collectHealthSnapshot, readDeliveryMetrics }
