const fs = require('node:fs/promises')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { config } = require('./config')
const { mongoose } = require('./models')

function safeError(error) {
  let message = String(error?.description || error?.message || error).slice(0, 2000)
  for (const value of [config.botToken, config.indexKey, config.mongoUri]) {
    if (value) message = message.split(value).join('[REDACTED]')
  }
  return message.replace(/bot\d+:[\w-]+/g, 'bot[REDACTED]')
    .replace(/(mongodb(?:\+srv)?:\/\/)[^\s]+/g, '$1[REDACTED]')
}

function shutdownSignal() {
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return controller.signal
}

async function pause(ms, signal) {
  try { await delay(ms, undefined, { signal }) }
  catch (error) { if (error.name !== 'AbortError') throw error }
}

// One bounded status file per worker; no per-block success log growth.
async function health(name, state) {
  const directory = process.env.HEALTH_DIRECTORY || path.join(__dirname, '..', '.local', 'health')
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, `${name}.json`)
  await fs.writeFile(`${file}.tmp`, JSON.stringify({ ...state, updatedAt: new Date().toISOString(), pid: process.pid }))
  await fs.rename(`${file}.tmp`, file)
}

async function connectDatabase(signal, name) {
  let attempts = 0
  while (!signal.aborted) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000,
        socketTimeoutMS: 15000, autoIndex: false, maxPoolSize: 10 })
      return true
    } catch (error) {
      attempts += 1
      const message = safeError(error)
      console.error(`${name}: database unavailable (${attempts}): ${message}`)
      await health(name, { status: 'database_unavailable', error: message })
      await mongoose.disconnect()
      await pause(Math.min(1000 * 2 ** Math.min(attempts, 5), 30000), signal)
    }
  }
  return false
}

async function workerLoop(name, operation, { signal, intervalMs }) {
  let failures = 0
  let lastSuccessAt = null
  while (!signal.aborted) {
    let nextDelayMs = intervalMs
    try {
      const result = await operation()
      if (result?.catchingUp) nextDelayMs = 0
      failures = 0
      lastSuccessAt = new Date().toISOString()
      await health(name, { status: 'ok', lastSuccessAt, ...result })
    } catch (error) {
      failures += 1
      const message = safeError(error)
      if (failures === 1 || failures % 10 === 0) console.error(`${name}: ${message} (failure ${failures})`)
      await health(name, { status: 'retrying', lastSuccessAt, failures, error: message })
    }
    await pause(failures ? Math.min(intervalMs * 2 ** Math.min(failures, 5), 30000) : nextDelayMs, signal)
  }
}

module.exports = { safeError, shutdownSignal, pause, health, connectDatabase, workerLoop }
