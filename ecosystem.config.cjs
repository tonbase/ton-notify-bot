const path = require('node:path')
const fs = require('node:fs')
const directory = path.join(__dirname, '.local', 'logs')
fs.mkdirSync(directory, { recursive: true })

module.exports = { apps: [
  { name: 'bot', script: 'src/bot.js' },
  { name: 'scanner', script: 'src/scanner.js' },
].map((app) => ({
  ...app, cwd: __dirname, instances: 1, exec_mode: 'fork',
  autorestart: true, exp_backoff_restart_delay: 1000,
  max_memory_restart: '512M', kill_timeout: 60000,
  time: true, out_file: path.join(directory, `${app.name}-out.log`),
  error_file: path.join(directory, `${app.name}-error.log`),
  env: { NODE_ENV: 'production' },
})) }
