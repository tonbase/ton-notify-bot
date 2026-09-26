const test = require('node:test')
const assert = require('node:assert/strict')
const { TonCenter, RequestLimiter } = require('../src/toncenter')

test('HTTP and legacy body rate limits retry without converting error text to amounts', async () => {
  const replies = [new Response('Ratelimit exceed'),
    new Response(JSON.stringify({ ok: false, result: 'Ratelimit exceed' })),
    new Response('busy', { status: 429, headers: { 'retry-after': '3' } }),
    new Response('unavailable', { status: 503 }),
    new Response(JSON.stringify({ last: { seqno: 42 } }))]
  const waits = []
  const client = new TonCenter({ apiKey: 'test', fetch: async () => replies.shift(),
    wait: async (ms) => waits.push(ms), limiter: { run: (fn) => fn() } })
  assert.equal((await client.masterchainInfo()).last.seqno, 42)
  assert.equal(waits.length, 4)
  assert(waits[2] >= 3000)
})

test('timeouts retry finitely, authentication errors fail without exposing remote bodies', async () => {
  let calls = 0
  const options = { apiKey: 'test', wait: async () => {}, limiter: { run: (fn) => fn() } }
  const timeout = new TonCenter({ ...options, fetch: async () => { calls += 1; throw new DOMException('timeout', 'TimeoutError') } })
  await assert.rejects(() => timeout.masterchainInfo(), /timeout/)
  assert.equal(calls, 5)
  const auth = new TonCenter({ ...options, fetch: async () => new Response('secret-from-upstream', { status: 401 }) })
  await assert.rejects(() => auth.masterchainInfo(), (error) => /401/.test(error.message) && !error.message.includes('secret'))
})

test('concurrent requests share start pacing and release slots after failures', async () => {
  const waits = []
  const limiter = new RequestLimiter(50, 3, { now: () => 0, wait: async (ms) => { waits.push(ms) } })
  let active = 0
  let peak = 0
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => limiter.run(async () => {
    active += 1; peak = Math.max(peak, active)
    await new Promise((resolve) => setImmediate(resolve))
    active -= 1
    if (index === 2) throw new Error('failed')
  })))
  assert.equal(peak, 3)
  assert.deepEqual(waits, [20, 40, 60, 80, 100, 120, 140])
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
  assert.equal(limiter.active, 0)
})
