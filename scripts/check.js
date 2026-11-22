const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return javascriptFiles(file)
    return /\.(?:c?js)$/.test(entry.name) ? [file] : []
  })
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

const files = ['src', 'scripts', 'test'].flatMap((directory) => javascriptFiles(path.join(root, directory)))
files.push(path.join(root, 'ecosystem.config.cjs'))
for (const file of files) run(['--check', file])
console.log(`Syntax checked ${files.length} JavaScript files`)
run(['--test', ...javascriptFiles(path.join(root, 'test')).filter((file) => file.endsWith('.test.js'))])
