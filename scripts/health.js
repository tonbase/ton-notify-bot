const path = require('node:path')
const { config } = require('../src/config')
const { mongoose, Delivery, Counter } = require('../src/models')
const { evaluateHealth, collectHealthSnapshot, readDeliveryMetrics } = require('../src/health')

async function main() {
  const volume = path.join(__dirname, '..')
  const directory = process.env.HEALTH_DIRECTORY || path.join(volume, '.local', 'health')
  const snapshot = await collectHealthSnapshot({
    directory, volume, sendNotifications: config.sendNotifications, liveRecovery: config.liveRecovery,
    readDatabase: async () => {
      try {
        await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 })
        return config.sendNotifications ? await readDeliveryMetrics({ Delivery, Counter }) : {}
      } finally { await mongoose.disconnect() }
    },
  })
  const result = evaluateHealth(snapshot, { sendNotifications: config.sendNotifications, liveRecovery: config.liveRecovery })
  for (const item of result.checks) {
    console.log(`${item.name}: ${item.healthy ? 'OK' : 'UNHEALTHY'} ${JSON.stringify({ issues: item.issues, ...item.metrics })}`)
  }
  process.exitCode = result.healthy ? 0 : 1
}

if (require.main === module) main().catch(() => { console.error('Health check failed'); process.exitCode = 1 })
module.exports = { main }
