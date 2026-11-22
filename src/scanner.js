const { Api } = require('grammy')
const { config, requireBotToken } = require('./config')
const { mongoose } = require('./models')
const { TonCenter } = require('./toncenter')
const { scanCycle } = require('./block-scanner')
const { sendPendingParallel } = require('./delivery')
const { ensureDeliveryIndexes } = require('./delivery-queue')
const { ensureDigestIndexes } = require('./digest')
const { loadDeliveryState } = require('./delivery-state')
const { createTelegramSender } = require('./telegram-sender')
const { refreshAddressBook } = require('./address-book')
const { tonUsdPrice, REFRESH_MS } = require('./prices')
const { safeError, shutdownSignal, connectDatabase, workerLoop, health } = require('./runtime')
const { loadRecoveryState, deliveryPolicy, backfillCapacityReady, initializeBackfill } = require('./recovery-mode')

async function main() {
  if (config.sendNotifications) requireBotToken()
  const signal = shutdownSignal()
  if (!await connectDatabase(signal, 'scanner')) return
  try {
    await ensureDeliveryIndexes({ liveRecovery: config.liveRecovery })
    await ensureDigestIndexes()
    const client = new TonCenter()
    const recovery = config.liveRecovery ? await loadRecoveryState(client) : null
    const scanState = {}
    const backfillState = {}
    const state = config.sendNotifications ? await loadDeliveryState() : null
    const sender = state ? createTelegramSender(new Api(config.botToken, { timeoutSeconds: 30 }), state) : null
    if (!sender) await health('delivery', { status: 'disabled' })
    await tonUsdPrice.refresh().catch(() => {})
    console.log(`Scanner connected; Telegram delivery ${config.sendNotifications ? 'enabled' : 'disabled'}`)
    const workers = [workerLoop('scanner', async () => {
      scanState.ready = false
      await scanCycle(client, scanState, { signal, ...(recovery ? {
        cursorName: recovery.cursorName, startSeqno: recovery.startSeqno, deliveryLane: 'live', requireExistingCursor: true,
      } : {}) })
      scanState.ready = true
      scanState.lastSuccessMs = Date.now()
      const lag = Math.max(0, scanState.tip - scanState.lastProcessed)
      return { seqno: scanState.lastProcessed, tip: scanState.tip, lag, catchingUp: lag > 0 }
    }, { signal, intervalMs: config.scanIntervalMs }),
    workerLoop('address-book', () => refreshAddressBook(), { signal, intervalMs: 3600000 }),
    workerLoop('prices', () => tonUsdPrice.refresh(), { signal, intervalMs: REFRESH_MS })]
    if (recovery) {
      workers.push(workerLoop('backfill', async () => {
        await initializeBackfill(backfillState, recovery.endSeqno)
        if (!backfillState.complete) {
          if (!await backfillCapacityReady(backfillState)) {
            return { status: 'paused_capacity', seqno: backfillState.lastProcessed, tip: recovery.endSeqno,
              lag: Number.isSafeInteger(backfillState.lastProcessed) ? recovery.endSeqno - backfillState.lastProcessed : undefined,
              catchingUp: false }
          }
          await scanCycle(client, backfillState, { signal, endSeqno: recovery.endSeqno, replayBlocks: 0, requireExistingCursor: true })
          backfillState.complete = Number.isSafeInteger(backfillState.lastProcessed) && backfillState.lastProcessed >= recovery.endSeqno
        }
        const lag = Math.max(0, recovery.endSeqno - backfillState.lastProcessed)
        return { seqno: backfillState.lastProcessed, tip: recovery.endSeqno, lag, catchingUp: lag > 0 }
      }, { signal, intervalMs: Math.max(10000, config.scanIntervalMs) }))
    }
    if (sender) {
      workers.push(workerLoop('delivery', async () => {
        // An unverified or stale live iteration cannot release summaries.
        // Historical windows remain held until their fixed backfill completes.
        const policy = deliveryPolicy(recovery, scanState, backfillState)
        const sent = await sendPendingParallel(sender, state,
          { batchSize: config.notificationBatchSize, concurrency: 8, ...policy, signal,
            getDeliveryPolicy: () => deliveryPolicy(recovery, scanState, backfillState) })
        return {
          status: state.cooldownUntil > Date.now() ? 'rate_limited' : 'ok',
          sent, caughtUp: policy.caughtUp, backfillComplete: policy.backfillComplete,
          lastSentAt: state.lastSentAt || null, cooldownUntil: state.cooldownUntil || 0,
        }
      }, { signal, intervalMs: 1000 }))
    }
    await Promise.all(workers)
  } finally { await mongoose.disconnect() }
}

if (require.main === module) main().catch((error) => { console.error(safeError(error)); process.exit(1) })

module.exports = { main }
