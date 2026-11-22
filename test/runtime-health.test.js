const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { mongoose } = require('../src/models')
const { health, connectDatabase, workerLoop } = require('../src/runtime')

function fullDisk(t) {
  t.mock.method(fs, 'mkdir', async () => {})
  t.mock.method(fs, 'writeFile', async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) })
  return t.mock.method(console, 'error', () => {})
}

test('health storage failure remains best effort and repeated errors are bounded', async (t) => {
  const errors = fullDisk(t)
  for (let i = 0; i < 20; i += 1) assert.equal(await health('full-disk', { status: 'ok' }), false)
  assert.equal(errors.mock.callCount(), 1)
  t.mock.method(fs, 'writeFile', async () => {})
  t.mock.method(fs, 'rename', async () => {})
  assert.equal(await health('full-disk', { status: 'ok' }), true)
  t.mock.method(fs, 'writeFile', async () => { throw new Error('disk full again') })
  assert.equal(await health('full-disk', { status: 'ok' }), false)
  assert.equal(errors.mock.callCount(), 1)
})

test('database reconnect survives ENOSPC while recording the initial connection failure', async (t) => {
  fullDisk(t)
  let attempts = 0
  t.mock.method(mongoose, 'connect', async () => {
    attempts += 1
    if (attempts === 1) throw new Error('database unavailable')
  })
  const disconnect = t.mock.method(mongoose, 'disconnect', async () => {})
  assert.equal(await connectDatabase(new AbortController().signal, 'reconnecting'), true)
  assert.equal(attempts, 2)
  assert.equal(disconnect.mock.callCount(), 1)
})

test('worker retries its operation even when both success and error health writes fail', async (t) => {
  fullDisk(t)
  const controller = new AbortController()
  let calls = 0
  await workerLoop('retrying-operation', async () => {
    calls += 1
    if (calls === 1) throw new Error('temporary operation failure')
    if (calls === 3) controller.abort()
    return { catchingUp: true }
  }, { signal: controller.signal, intervalMs: 1 })
  assert.equal(calls, 3)
})
