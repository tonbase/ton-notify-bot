const { Counter } = require('./models')
const { config } = require('./config')
const { WINDOW_MS } = require('./digest')
const fs = require('node:fs/promises')
const path = require('node:path')

const LIVE_CURSOR_NAME = 'actions_live_recovery_v1'

async function initializeBackfill(state, endSeqno) {
  if (Number.isSafeInteger(state.lastProcessed)) return
  const saved = await Counter.findOne({ name: 'actions_scan_v1' }).lean()
  const seqno = saved?.data?.seqno
  if (!Number.isSafeInteger(seqno) || seqno < 0) throw new Error('Historical recovery cursor is missing or invalid')
  state.lastProcessed = seqno
  state.complete = seqno >= endSeqno
}

async function backfillCapacityReady(state, { fileSystem = fs,
  volumes = [path.join(__dirname, '..'), process.env.RECOVERY_DATA_VOLUME || '/var/lib/mongodb'] } = {}) {
  const minimum = (state.capacityPaused !== false ? 7 : 6) * 1024 ** 3
  state.capacityPaused = true
  const measurements = await Promise.all(volumes.map(volume => fileSystem.statfs(volume)))
  const ready = measurements.every(stat => {
    const free = Number(stat.bavail) * Number(stat.bsize)
    const total = Number(stat.blocks) * Number(stat.bsize)
    if (!Number.isFinite(free) || !Number.isFinite(total) || free < 0 || total <= 0 || free > total) {
      throw new Error('Invalid backfill capacity measurement')
    }
    return free >= minimum && free / total >= 0.15
  })
  state.capacityPaused = !ready
  return ready
}

function validateRecovery(data) {
  if (!data || !Number.isSafeInteger(data.start_seqno) || data.start_seqno < 1 ||
      !Number.isSafeInteger(data.seqno) || data.seqno < data.start_seqno - 1 ||
      !Number.isSafeInteger(data.digest_from_ms) || data.digest_from_ms <= 0 || data.digest_from_ms % WINDOW_MS !== 0) {
    throw new Error('Invalid persisted live recovery boundary')
  }
  return { cursorName: LIVE_CURSOR_NAME, startSeqno: data.start_seqno,
    endSeqno: data.start_seqno - 1, digestFrom: new Date(data.digest_from_ms) }
}

async function loadRecoveryState(client) {
  const existing = await Counter.findOne({ name: LIVE_CURSOR_NAME }).lean()
  if (existing) return validateRecovery(existing.data)
  const { last } = await client.masterchainInfo()
  const seconds = Number(last.gen_utime)
  const cutover = last.seqno - config.lagBlocks
  if (!Number.isSafeInteger(last.seqno) || !Number.isSafeInteger(seconds) || seconds <= 0 || cutover < 0) {
    throw new Error('Invalid block metadata for live recovery')
  }
  const data = { seqno: cutover, start_seqno: cutover + 1,
    digest_from_ms: Math.ceil((seconds * 1000 + 1) / WINDOW_MS) * WINDOW_MS,
    created_at: new Date().toISOString() }
  let saved
  try {
    saved = await Counter.findOneAndUpdate({ name: LIVE_CURSOR_NAME }, { $setOnInsert: { data } },
      { upsert: true, new: true, lean: true })
  } catch (error) {
    if (error.code !== 11000) throw error
    saved = await Counter.findOne({ name: LIVE_CURSOR_NAME }).lean()
  }
  return validateRecovery(saved?.data)
}

function deliveryPolicy(recovery, live, backfill, now = Date.now()) {
  const age = now - live.lastSuccessMs
  const caughtUp = live.ready === true && Number.isFinite(age) && age >= 0 && age < 120000 &&
    Number.isSafeInteger(live.tip) && Number.isSafeInteger(live.lastProcessed) && live.lastProcessed >= live.tip
  const backfillComplete = !recovery || (backfill.complete === true &&
    Number.isSafeInteger(backfill.lastProcessed) && backfill.lastProcessed >= recovery.endSeqno)
  return { caughtUp, backfillComplete, excludeDigests: !caughtUp,
    digestNotBefore: recovery && !backfillComplete ? recovery.digestFrom : undefined, preferLive: Boolean(recovery) }
}

module.exports = { LIVE_CURSOR_NAME, validateRecovery, loadRecoveryState, deliveryPolicy, backfillCapacityReady, initializeBackfill }
