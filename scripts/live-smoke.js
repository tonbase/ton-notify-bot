const { randomUUID } = require('node:crypto')
const { mongoose, Address, User, Delivery } = require('../src/models')
const { TonCenter } = require('../src/toncenter')
const { rawAddress } = require('../src/address')
const { loadWatched, scanBlock } = require('../src/scanner')

async function main() {
  const client = new TonCenter()
  const samples = []
  for (const type of ['ton_transfer', 'jetton_transfer', 'nft_transfer']) {
    const page = await client.actions({ action_type: type, limit: 10, sort: 'desc' })
    const action = page.actions.find((item) => {
      const d = item.details || {}
      return item.success !== false && rawAddress(d.source || d.sender || d.old_owner || d.new_owner)?.startsWith('0:')
    })
    if (!action) throw new Error(`No recent ${type} action found`)
    samples.push({ type, action, address: rawAddress(action.details.source || action.details.sender || action.details.old_owner || action.details.new_owner) })
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
    for (const sample of samples) {
      const delivery = await Delivery.findOne({ action_id: sample.action.action_id })
      const title = { ton_transfer: 'TON transfer', jetton_transfer: 'Jetton transfer', nft_transfer: 'NFT transfer' }[sample.type]
      if (!delivery || !delivery.text.includes(title)) {
        throw new Error(`No formatted delivery queued for ${sample.type}`)
      }
      console.log(`PASS ${sample.type}: ${sample.address} → durable notification ${delivery._id.slice(0, 12)}`)
    }
  } finally {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
