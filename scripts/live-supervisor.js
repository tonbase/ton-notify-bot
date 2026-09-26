const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { directory, readLive } = require('../src/live-control')

async function main() {
  fs.mkdirSync(directory, { recursive: true })
  const lock = path.join(directory, 'supervisor.pid')
  if (fs.existsSync(lock)) {
    let running = false
    try { process.kill(Number(fs.readFileSync(lock)), 0); running = true } catch { /* stopped */ }
    if (running) throw Error('Live supervisor is already running')
  }
  fs.writeFileSync(lock, String(process.pid))
  process.once('exit', () => {
    if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock)
  })
  let first = true, output = '', stopping = false, child
  const stop = () => { stopping = true; child?.kill() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  while (!stopping) {
    child = spawn(process.execPath, [path.join(__dirname, 'live-stream.js'),
      ...(first && process.argv.includes('--start') ? ['--start'] : [])], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    first = false
    const log = data => {
      output = (output + data.toString()).slice(-32768)
      fs.writeFileSync(path.join(directory, 'stream.log'), output)
    }
    child.stdout.on('data', log); child.stderr.on('data', log)
    await once(child, 'exit')
    const control = readLive('control.json')
    if (stopping || !control?.enabled || control.mode !== 'all-types') break
    log('\nRestarting the local live worker in 10 seconds.\n')
    await new Promise(resolve => setTimeout(resolve, 10000))
  }
}
main().catch(() => { console.error('Local live supervisor failed'); process.exitCode = 1 })
