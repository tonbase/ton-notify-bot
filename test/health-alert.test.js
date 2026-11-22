const test = require('node:test')
const assert = require('node:assert/strict')
const { decision, message, parseHealth, deliverChange } = require('../ops/health-alert')

test('recovery configuration requires the historical worker before an all-clear', () => {
  const output = ['scanner', 'delivery-heartbeat', 'disk', 'database', 'delivery'].map(name => name + ': OK {"issues":[]}').join('\n')
  assert(parseHealth(output, { liveRecovery: true }).includes('application:missing_health_checks'))
  assert.deepEqual(parseHealth(output + '\nbackfill: OK {"issues":[]}', { liveRecovery: true }), [])
})

test('alerts only announce a changed problem or recovery, with a five-minute minimum interval', () => {
  const now = 1000000
  assert.equal(decision({}, [], now), null)
  assert.deepEqual(decision({}, ['database:unavailable'], now), { signature: 'database:unavailable', recovery: false })
  assert.equal(decision({ signature: 'database:unavailable', sentAt: now - 600000 }, ['database:unavailable'], now), null)
  assert.equal(decision({ signature: 'database:unavailable', sentAt: now - 1000 }, [], now), null)
  assert.deepEqual(decision({ signature: 'database:unavailable', sentAt: now - 600000 }, [], now), { signature: '', recovery: true })
})

test('provider cooldown suppresses changed alerts and issue ordering does not create duplicates', () => {
  assert.equal(decision({ retryAt: 2000 }, ['disk:low'], 1000), null)
  assert.equal(decision({ signature: 'a|b' }, ['b', 'a', 'b'], 1000), null)
})

test('test alert makes no health claim and operational messages stay within Telegram length', () => {
  assert.match(message([], '', { test: true }), /тест аварийных оповещений/)
  assert(!message([], '', { test: true }).includes('снова проходят'))
  assert(message(['disk:low'], 'x'.repeat(10000)).length <= 3500)
})

test('missing or malformed health output cannot report recovery', () => {
  const complete = ['scanner', 'delivery-heartbeat', 'disk', 'database', 'delivery'].map(name => name + ': OK {"issues":[]}').join('\n')
  assert.deepEqual(parseHealth(complete), [])
  for (const output of ['', complete.split('\n').slice(1).join('\n'), complete.replace('"issues":[]', '"issues":null'), complete + '\nunknown']) {
    assert(parseHealth(output).length > 0)
  }
  assert(parseHealth(complete.replace('scanner: OK {"issues":[]}', 'scanner: UNHEALTHY {"issues":["stale"]}')).includes('scanner:stale'))
})

test('failed pre-send state persistence prevents a message', async () => {
  let sent = 0
  await assert.rejects(deliverChange({}, { issues: ['disk:low'], details: '' }, {
    now: () => 1000000, save: async () => { throw new Error('ENOSPC') }, transmit: async () => { sent++ },
  }))
  assert.equal(sent, 0)
})

test('successful send followed by failed state commit retains a five-minute cooldown', async () => {
  let saved
  let sent = 0
  await assert.rejects(deliverChange({}, { issues: ['disk:low'], details: '' }, {
    now: () => 1000000,
    save: async value => { if (saved) throw new Error('ENOSPC'); saved = value },
    transmit: async () => { sent++ },
  }))
  assert.equal(sent, 1)
  assert.equal(decision(saved, ['disk:low'], 1060000), null)
  assert(decision(saved, ['disk:low'], 1300000))
})

test('Telegram retry-after longer than local cooldown is retained', async () => {
  let saved
  await assert.rejects(deliverChange({}, { issues: ['disk:low'], details: '' }, {
    now: () => 1000000, save: async value => { saved = value },
    transmit: async () => { const error = new Error('rate limited'); error.retryAt = 2000000; throw error },
  }))
  assert.equal(saved.retryAt, 2000000)
})
