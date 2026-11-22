const { config } = require('./config')
const { Counter } = require('./models')
const { loadWatched, routeEntries, flushDigestBatches } = require('./notification-router')

const CURSOR_NAME = 'actions_scan_v1'

async function scanBlock(client, seqno, watched, { digestBatches, deliveryLane } = {}) {
  let offset = 0
  const entries = []
  let lastPageId = null
  for (;;) {
    const page = await client.actions({ mc_seqno: seqno, limit: config.pageSize, offset, sort: 'asc', include_accounts: true })
    if (offset && page.actions[0]?.action_id === lastPageId) {
      throw new Error(`Indexer returned duplicate page for block ${seqno}`)
    }
    for (const action of page.actions) entries.push({ action, metadata: page.metadata || {} })
    if (page.actions.length < config.pageSize) break
    lastPageId = page.actions[0]?.action_id
    offset += page.actions.length
    if (offset > 1000000) throw new Error(`Block ${seqno} exceeded action safety limit`)
  }
  await routeEntries(entries, watched, digestBatches, deliveryLane)
  return entries.length
}

async function scanCycle(client, state = {}, { signal, cursorName = CURSOR_NAME,
  startSeqno = config.startSeqno, endSeqno, replayBlocks = config.replayBlocks, deliveryLane, requireExistingCursor = false } = {}) {
  const { last } = await client.masterchainInfo()
  const chainTip = last.seqno - config.lagBlocks
  const tip = endSeqno === undefined ? chainTip : Math.min(chainTip, endSeqno)
  state.tip = tip
  if (tip < 0) return state
  const cursor = await Counter.findOne({ name: cursorName }).lean()
  let seqno = cursor?.data?.seqno
  if (requireExistingCursor && (!Number.isSafeInteger(seqno) || seqno < 0 ||
      (startSeqno !== null && seqno < startSeqno - 1))) throw new Error('Recovery cursor is missing or invalid')
  if (!Number.isSafeInteger(seqno)) {
    const legacy = cursorName === CURSOR_NAME && startSeqno === null
      ? await Counter.findOne({ name: 'lastCheckedBlock' }).lean() : null
    seqno = startSeqno !== null ? startSeqno - 1
      : Number.isSafeInteger(legacy?.data?.seqno) ? Math.max(0, legacy.data.seqno - 1) : tip
    await Counter.updateOne({ name: cursorName }, { $set: { data: { seqno } } }, { upsert: true })
    console.log(`Scanner cursor initialized at ${seqno}`)
  }
  state.lastProcessed = seqno
  // A deliberate cutover can be newer than the indexer's safety boundary.
  // Wait for that block to mature before scanning or replaying it.
  if (startSeqno !== null && tip < startSeqno) return state
  if (endSeqno !== undefined && seqno >= endSeqno) return state
  const watched = await loadWatched()
  const end = Math.min(tip, seqno + 40)
  const digestBatches = new Map()
  const completed = []
  let failure
  let failed = false
  groups: for (let start = seqno + 1; start <= end; start += config.blockConcurrency) {
    if (signal?.aborted) break
    const blocks = Array.from({ length: Math.min(config.blockConcurrency, end - start + 1) }, (_, i) => start + i)
    const results = await Promise.allSettled(blocks.map((block) => scanBlock(client, block, watched, { digestBatches, deliveryLane })))
    // Concurrent fetches/writes may complete out of order. Commit only the
    // contiguous successful prefix; replay deduplicates later saved blocks.
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') { failure = result.reason; failed = true; break groups }
      completed.push(blocks[index])
    }
  }
  // Recipient arrays are rewritten once per window/cycle. No successful block
  // becomes a committed cursor until all buffered digest writes are durable.
  await flushDigestBatches(digestBatches)
  for (const block of completed) {
    await Counter.updateOne({ name: cursorName }, { $max: { 'data.seqno': block } })
    state.lastProcessed = block
  }
  if (failed) throw failure
  const lastProcessed = state.lastProcessed || seqno
  if (!signal?.aborted && replayBlocks > 0 && lastProcessed > 0 && tip - lastProcessed <= replayBlocks * 2) {
    if (state.replayWindowEnd === undefined || state.replayOffset >= replayBlocks) {
      state.replayWindowEnd = lastProcessed
      state.replayOffset = 0
    }
    const replay = Math.max(startSeqno || 1, state.replayWindowEnd - state.replayOffset)
    await scanBlock(client, replay, watched, { deliveryLane })
    state.replayOffset += 1
  }
  return state
}

module.exports = { scanBlock, scanCycle }
