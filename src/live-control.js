const fs = require('node:fs')
const path = require('node:path')

const directory = path.join(__dirname, '..', '.local', 'live-lab')
function readLive(name, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
function writeLive(name, data) {
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, name)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
function stopLive() {
  const control = readLive('control.json')
  if (control) writeLive('control.json', { ...control, enabled: false })
}
function liveStatus() {
  const status = readLive('status.json')
  if (!status) return 'Реальные уведомления ещё не запускались.'
  if (status.status === 'running' && Date.now() - Date.parse(status.updatedAt) > 120000) {
    return `Нет свежего статуса сканера. Поток мог прерваться. Отправлено: ${status.sent || 0}.`
  }
  const enabled = readLive('control.json')?.enabled && status.status === 'running'
  if (status.mode === 'all-types') {
    return `${enabled ? 'Непрерывный поток включён' : 'Поток остановлен'}. Отправлено: ${status.sent || 0}.\nВсе доступные типы, без лимита сообщений; интервал ${Math.round((status.intervalMs || 5000) / 1000)} сек.\n/live_stop — остановить.`
  }
  return `${enabled ? 'Поток включён' : 'Поток остановлен'}. Отправлено: ${status.sent || 0} / ${status.maxMessages || 30}.\n/live_stop — остановить.`
}
module.exports = { directory, readLive, writeLive, stopLive, liveStatus }
