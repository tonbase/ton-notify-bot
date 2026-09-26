const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const { mongoose, Address, User, Delivery } = require('../src/models')
const { TonCenter } = require('../src/toncenter')
const { rawAddress } = require('../src/address')
const { loadWatched, scanBlock, reconcileTraces } = require('../src/scanner')
const { participants } = require('../src/events')

async function main() {
  const client = new TonCenter()
  const samples = []
  for (const type of ['ton_transfer', 'jetton_transfer', 'nft_transfer', 'jetton_mint',
    'jetton_burn', 'jetton_swap', 'nft_mint', 'stake_deposit', 'dex_deposit_liquidity']) {
    const page = await client.actions({ action_type: type, limit: 10, sort: 'desc' })
    const action = page.actions.find((item) => {
      return item.success !== false && participants(item).some((address) => address.startsWith('0:'))
    })
    if (!action) throw new Error(`No recent ${type} action found`)
    const d = action.details
    samples.push({ type, action, address: rawAddress(d.source || d.sender || d.real_old_owner || d.old_owner || d.receiver || d.owner || d.stake_holder)
      || participants(action).find((address) => address.startsWith('0:')) })
  }
  const name = `ton-notify-smoke-${randomUUID().slice(0, 8)}`
  const uri = process.env.SMOKE_MONGODB_URI || `mongodb://127.0.0.1:27018/${name}`
  const target = new URL(uri.replace(/^mongodb:/, 'http:'))
  const dbName = target.pathname.slice(1)
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !dbName.startsWith('ton-notify-smoke-')) {
    throw new Error('Smoke test requires a disposable localhost ton-notify-smoke-* database')
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, autoIndex: false })
  try {
    for (const [index, sample] of samples.entries()) {
      const userId = 900000 + index
      await User.create({ user_id: userId, first_name: 'Smoke test' })
      await Address.create({ user_id: userId, address: sample.address, tag: sample.type })
    }
    const watched = await loadWatched()
    for (const seqno of [...new Set(samples.map((sample) => sample.action.trace_mc_seqno_end))]) {
      const count = await scanBlock(client, seqno, watched)
      console.log(`Scanned block ${seqno}: ${count} actions`)
    }
    const preview = []
    for (const sample of samples) {
      const delivery = await Delivery.findOne({ action_id: sample.action.action_id })
      if (!delivery || !delivery.text.includes('<b>')) {
        throw new Error(`No formatted delivery queued for ${sample.type}`)
      }
      console.log(`PASS ${sample.type}: ${sample.address} → durable notification ${delivery._id.slice(0, 12)}`)
      preview.push(`<article>${delivery.text}</article>`)
    }
    await reconcileTraces(client)
    const before = await Delivery.countDocuments()
    for (const seqno of [...new Set(samples.map((sample) => sample.action.trace_mc_seqno_end))]) await scanBlock(client, seqno, watched)
    assert.equal(await Delivery.countDocuments(), before, 'Block replay must not duplicate deliveries')
    const directory = path.join(__dirname, '..', '.local')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'live-notifications.html'), `<!doctype html><meta charset="utf-8"><title>Live TON notifications</title><style>body{font:16px system-ui;background:#eef3f7;max-width:780px;margin:32px auto}article{white-space:pre-wrap;background:white;border-radius:16px;padding:24px;margin:16px 0;line-height:1.7}a{color:#007dad}h1{font-size:24px}</style><h1>Live TON notification samples</h1>${preview.join('\n')}`)
    console.log('PASS trace reconciliation and duplicate-free block replay; preview saved in .local/live-notifications.html')
  } finally {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
