const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { randomUUID } = require('node:crypto')
const assert = require('node:assert/strict')

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const directory = path.join(__dirname, '..', '.local', 'recovery', randomUUID())
  const dbPath = path.join(directory, 'db')
  const healthPath = path.join(directory, 'health')
  await fs.mkdir(dbPath, { recursive: true })
  const socket = net.createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const mongoPort = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  let tip = 100
  const api = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const data = url.pathname.endsWith('/masterchainInfo') ? { last: { seqno: tip } }
      : url.pathname.endsWith('/actions') ? { actions: [] } : { transactions: [] }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(data))
  })
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  let mongo
  let scanner
  const errors = []
  function startMongo() {
    mongo = spawn(process.argv[2] || 'mongod', ['--dbpath', dbPath, '--bind_ip', '127.0.0.1',
      '--port', String(mongoPort), '--logpath', path.join(directory, 'mongod.log'), '--logappend'],
    { windowsHide: true, stdio: 'ignore' })
    mongo.on('error', (error) => errors.push(error.message))
  }
  async function stop(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  async function until(predicate, description) {
    const end = Date.now() + 45000
    while (Date.now() < end) {
      if (errors.length) throw new Error(errors.join('; '))
      let state
      try { state = JSON.parse(await fs.readFile(path.join(healthPath, 'scanner.json'), 'utf8')) } catch { /* not started yet */ }
      if (state && predicate(state)) return state
      await pause(200)
    }
    throw new Error(`Timed out: ${description}`)
  }
  try {
    scanner = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'scanner.js')], {
      windowsHide: true, env: { ...process.env,
        MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/ton-notify-recovery`,
        TON_INDEX_URL: `http://127.0.0.1:${api.address().port}/api/v3`, TON_INDEX_API_KEY: 'test',
        BOT_TOKEN: '', NOTIFICATIONS_CHANNEL_ID: '', SEND_NOTIFICATIONS: 'false',
        SCAN_INTERVAL_MS: '1000', SCAN_LAG_BLOCKS: '0', SCAN_REPLAY_BLOCKS: '0', SCAN_START_SEQNO: '100',
        HEALTH_DIRECTORY: healthPath,
      }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    scanner.stdout.on('data', (data) => { output = (output + data).slice(-10000) })
    scanner.stderr.on('data', (data) => { output = (output + data).slice(-10000) })
    scanner.on('error', (error) => errors.push(error.message))
    await until((state) => state.status === 'database_unavailable', 'initial database failure')
    console.log('PASS startup with unavailable MongoDB reports unhealthy and stays alive')
    startMongo()
    await until((state) => state.status === 'ok' && state.seqno === 100, 'database startup recovery')
    console.log('PASS scanner connects automatically when MongoDB becomes available')
    await stop(mongo)
    tip = 102
    const failed = await until((state) => state.status === 'retrying', 'database interruption')
    assert.equal(scanner.exitCode, null)
    startMongo()
    const recovered = await until((state) => state.status === 'ok' && state.seqno === 102, 'database reconnection')
    assert(Date.parse(recovered.lastSuccessAt) > Date.parse(failed.lastSuccessAt))
    console.log('PASS MongoDB interruption/recovery preserves cursor and resumes scanning without restarting scanner')
    await fs.writeFile(path.join(directory, 'scanner.log'), output)
  } finally {
    await stop(scanner)
    await stop(mongo)
    await new Promise((resolve) => api.close(resolve))
  }
}

main().catch((error) => { console.error(error.message); process.exit(1) })
