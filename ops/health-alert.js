const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)
const app = path.resolve(__dirname, '..')
const stateFile = process.env.ALERT_STATE_FILE || '/run/ton-notify-alerts/state.json'
const services = ['mongod.service', 'ton-notify-bot.service', 'ton-notify-scanner.service']

function decision(previous, issues, now) {
  const signature = [...new Set(issues)].sort().join('|')
  if (previous.retryAt > now || previous.signature === signature) return null
  if (!signature && !previous.signature) return null
  if (previous.sentAt && now - previous.sentAt < 5 * 60000) return null
  return { signature, recovery: !signature }
}

function message(issues, details, { recovery = false, test = false } = {}) {
  if (test) return 'TON Notify: тест аварийных оповещений. Сообщения об отказе базы, нехватке места и остановке уведомлений будут приходить в этот личный чат.'
  const heading = recovery ? 'TON Notify: проверки снова проходят.' : 'TON Notify: требуется внимание.'
  return [heading, ...issues.map(value => '- ' + value), '', details].join('\n').slice(0, 3500)
}

async function collect() {
  const issues = []
  const details = []
  for (const service of services) {
    try { await run('/usr/bin/systemctl', ['is-active', '--quiet', service], { timeout: 5000 }) }
    catch { issues.push('service:' + service) }
  }
  for (const volume of [app, '/var/lib/mongodb']) {
    try {
      const stat = await fs.statfs(volume)
      const free = Number(stat.bavail) * Number(stat.bsize)
      if (free < 8 * 1024 ** 3) issues.push('disk:reserve_below_8GiB')
      details.push('Свободно: ' + (free / 1024 ** 3).toFixed(1) + ' GiB (' + volume + ')')
    } catch { issues.push('disk:measurement_failed') }
  }
  let healthOutput = ''
  try {
    const result = await run(process.execPath, ['scripts/health.js'], { cwd: app, timeout: 35000, maxBuffer: 16384 })
    healthOutput = result.stdout
  } catch (error) {
    healthOutput = error.stdout || ''
    issues.push('application:health_failed')
  }
  let liveRecovery = false
  try { liveRecovery = require('../src/config').config.liveRecovery }
  catch { issues.push('application:configuration_failed') }
  issues.push(...parseHealth(healthOutput, { liveRecovery }))
  details.push(healthOutput.trim())
  return { issues: [...new Set(issues)].sort(), details: details.join('\n') }
}

function parseHealth(output, { liveRecovery = false } = {}) {
  const expected = new Set(['scanner', 'delivery-heartbeat', 'disk', 'database', 'delivery'])
  if (liveRecovery) expected.add('backfill')
  const seen = new Set()
  const issues = []
  // Signatures exclude changing ages/counts. Missing checks cannot mean recovery.
  for (const line of output.trim().split('\n')) {
    const match = line.match(/^(\S+): (OK|UNHEALTHY) (\{.*\})$/)
    if (!match || !expected.has(match[1]) || seen.has(match[1])) {
      issues.push('application:invalid_health_output')
      continue
    }
    try {
      const data = JSON.parse(match[3])
      if (!Array.isArray(data.issues) || !data.issues.every(issue => typeof issue === 'string') ||
          (match[2] === 'OK') !== (data.issues.length === 0)) throw new Error('Invalid health record')
      seen.add(match[1])
      issues.push(...data.issues.map(issue => match[1] + ':' + issue))
    } catch { issues.push('application:invalid_health_output') }
  }
  if ([...expected].some(name => !seen.has(name))) issues.push('application:missing_health_checks')
  return [...new Set(issues)]
}

async function readState() {
  try { const data = JSON.parse(await fs.readFile(stateFile, 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {} }
  catch { return {} }
}

async function saveState(value) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 })
  await fs.writeFile(stateFile + '.tmp', JSON.stringify(value), { mode: 0o600 })
  await fs.rename(stateFile + '.tmp', stateFile)
}

async function send(text) {
  const token = process.env.ALERT_BOT_TOKEN
  const chatId = process.env.ALERT_CHAT_ID
  if (!token || !/^\d+$/.test(chatId || '')) throw new Error('Private alert destination is not configured')
  const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(10000),
  })
  const body = await response.json()
  if (!response.ok || !body.ok) {
    const error = new Error('Telegram alert delivery failed')
    const seconds = Number(body.parameters?.retry_after)
    if (Number.isFinite(seconds) && seconds > 0) error.retryAt = Date.now() + seconds * 1000 + 1000
    throw error
  }
  return body.result.message_id
}

async function deliverChange(previous, { issues, details }, { save = saveState, transmit = send, now = Date.now } = {}) {
  const next = decision(previous, issues, now())
  if (!next) return
  // Persist a retry deadline before sending, so a failed success commit cannot
  // cause a new message every timer tick. If persistence fails, do not send.
  const attempt = { ...previous, retryAt: now() + 5 * 60000 }
  await save(attempt)
  try {
    await transmit(message(issues, details, next))
    await save({ signature: next.signature, sentAt: now(), retryAt: 0 })
    console.log(next.recovery ? 'Recovery alert accepted by Telegram' : 'Incident alert accepted by Telegram')
  } catch (error) {
    if (error.retryAt > attempt.retryAt) await save({ ...attempt, retryAt: error.retryAt })
    throw new Error('Alert delivery/state update failed')
  }
}

async function main() {
  if (process.argv.includes('--test')) {
    await send(message([], '', { test: true }))
    console.log('Test alert accepted by Telegram')
    return
  }
  await deliverChange(await readState(), await collect())
}

if (require.main === module) main().catch(() => { console.error('Health alert check failed'); process.exitCode = 1 })
module.exports = { decision, message, collect, parseHealth, deliverChange }
