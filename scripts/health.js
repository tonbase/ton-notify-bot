const fs = require('node:fs')
const path = require('node:path')
const { config } = require('../src/config')
const { mongoose, Delivery, TraceTask } = require('../src/models')
const { safeError } = require('../src/runtime')

async function main() {
  const directory = process.env.HEALTH_DIRECTORY || path.join(__dirname, '..', '.local', 'health')
  let unhealthy = false
  for (const name of ['scanner', 'traces', ...(config.sendNotifications ? ['delivery'] : [])]) {
    let state
    try { state = JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), 'utf8')) }
    catch { state = { status: 'missing' } }
    const age = Date.now() - Date.parse(state.lastSuccessAt || state.updatedAt || 0)
    const ok = state.status === 'ok' && age < 120000 && !(state.lag > 1000)
    console.log(`${name}: ${ok ? 'OK' : 'UNHEALTHY'} ${JSON.stringify(state)}`)
    if (!ok) unhealthy = true
  }
  const disk = fs.statfsSync(path.join(__dirname, '..'))
  const free = disk.bavail * disk.bsize
  console.log(`Application volume free: ${(free / 1024 ** 3).toFixed(1)} GiB`)
  if (free < 1024 ** 3 || disk.bavail / disk.blocks < 0.05) unhealthy = true
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 })
    console.log(JSON.stringify({
      pendingDeliveries: await Delivery.countDocuments({ status: { $in: ['pending', 'sending'] } }),
      pendingTraces: await TraceTask.countDocuments({ status: 'pending' }),
    }))
  } catch (error) { unhealthy = true; console.error(`Database: ${safeError(error)}`) }
  finally { await mongoose.disconnect() }
  if (unhealthy) process.exitCode = 1
}
main().catch((error) => { console.error(safeError(error)); process.exit(1) })
