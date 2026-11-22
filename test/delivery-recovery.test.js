const test = require('node:test')
const assert = require('node:assert/strict')
const { Delivery, Counter } = require('../src/models')
const { sendPending, sendPendingParallel } = require('../src/delivery')
const { loadDeliveryState } = require('../src/delivery-state')
const { createTelegramSender, DeliveryDeferred, telegramError } = require('../src/telegram-sender')
const { RequestLimiter } = require('../src/request-limiter')

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const floodWait = (seconds = 30) => ({ error_code: 429, description: 'Too Many Requests', parameters: { retry_after: seconds } })
const delivery = (id, chatId = 123) => ({ _id: id, chat_id: chatId, text: `Event ${id}`, attempts: 1 })

test('an unsuccessful send still paces the next event for the same chat', async (t) => {
  let claims = 0
  let calls = 0
  t.mock.method(Delivery, 'findOneAndUpdate', async () => delivery(String(++claims)))
  t.mock.method(Delivery, 'updateOne', async () => {})
  t.mock.method(console, 'error', () => {})
  const state = {}
  const api = { sendMessage: async () => { calls += 1; throw { error_code: 500, description: 'Temporary failure' } } }
  assert.equal(await sendPending(api, state, { chatId: 123, maxMessages: 2 }), 0)
  assert.equal(calls, 1)
  assert.equal(claims, 1)
  assert(state.chats.get('123') > Date.now())
  assert.equal(await sendPending(api, state, { chatId: 123, maxMessages: 2 }), 0)
  assert.equal(calls, 1)
})

function mockCooldownStore(t, write = async () => {}) {
  let savedUntil = 0
  t.mock.method(Counter, 'findOne', () => ({ lean: async () => ({ data: { untilMs: savedUntil } }) }))
  t.mock.method(Counter, 'updateOne', async (_filter, update) => {
    const until = update.$max['data.untilMs']
    await write(until)
    savedUntil = Math.max(savedUntil, until)
  })
  return () => savedUntil
}

test('a request waiting in the limiter never reaches Telegram after another request receives 429', async () => {
  const firstRequest = deferred()
  const firstStarted = deferred()
  const calls = []
  const persisted = []
  const state = { persistCooldown: async (until) => persisted.push(until) }
  const error = floodWait()
  const limiter = new RequestLimiter(1000, 1, { now: () => 0, wait: async () => {} })
  const sender = createTelegramSender({ sendMessage: async (chatId) => {
    calls.push(chatId)
    firstStarted.resolve()
    await firstRequest.promise
    throw error
  } }, state, { limiter })
  const results = Promise.allSettled([sender.sendMessage(123, 'first'), sender.sendMessage(456, 'second')])
  await firstStarted.promise
  assert.deepEqual(calls, [123])
  firstRequest.resolve()
  const [first, second] = await results
  assert.equal(first.status, 'rejected')
  assert.equal(first.reason, error)
  assert.equal(second.status, 'rejected')
  assert(second.reason instanceof DeliveryDeferred)
  assert.equal(second.reason.untilMs, state.cooldownUntil)
  assert.deepEqual(calls, [123])
  assert.deepEqual(persisted, [state.cooldownUntil])
  assert.equal(limiter.active, 0)
})

test('global cooldown is saved before a failing queue retry write and survives restart', async (t) => {
  const order = []
  const storedUntil = mockCooldownStore(t, async () => { order.push('cooldown') })
  let claims = 0
  t.mock.method(Delivery, 'findOneAndUpdate', async () => { claims += 1; return delivery('first') })
  const failure = new Error('Queue write unavailable')
  t.mock.method(Delivery, 'updateOne', async () => { order.push('queue'); throw failure })
  let calls = 0
  const api = { sendMessage: async () => { calls += 1; throw floodWait() } }
  const state = await loadDeliveryState()
  await assert.rejects(sendPending(api, state), (error) => error === failure)
  assert.deepEqual(order, ['cooldown', 'queue'])
  assert(state.cooldownUntil > Date.now() + 29000)
  assert.equal(storedUntil(), state.cooldownUntil)
  assert.equal(await sendPending(api, state), 0)
  const restarted = await loadDeliveryState()
  assert.equal(restarted.cooldownUntil, state.cooldownUntil)
  assert.equal(await sendPending(api, restarted), 0)
  assert.equal(claims, 1)
  assert.equal(calls, 1)
})

test('delivery retries failed cooldown persistence before claiming or sending another message', async (t) => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const order = []
  let writes = 0
  const failure = new Error('Cooldown store unavailable')
  const storedUntil = mockCooldownStore(t, async () => {
    order.push('cooldown')
    writes += 1
    if (writes === 1) throw failure
  })
  const pending = [delivery('first'), delivery('second', 456)]
  let claims = 0
  t.mock.method(Delivery, 'findOneAndUpdate', async () => {
    claims += 1; order.push('claim')
    return pending.shift() || null
  })
  t.mock.method(Delivery, 'updateOne', async () => {})
  let sends = 0
  const api = { sendMessage: async () => {
    sends += 1; order.push('send')
    if (sends === 1) throw floodWait()
    return { message_id: sends }
  } }
  const state = await loadDeliveryState()
  await assert.rejects(sendPending(api, state), (error) => error === failure)
  assert.equal(state.cooldownDirty, true)
  assert.equal(storedUntil(), 0)
  assert.equal(await sendPending(api, state), 0)
  assert.equal(state.cooldownDirty, false)
  assert.equal(storedUntil(), state.cooldownUntil)
  assert.equal(claims, 1)
  assert.equal(sends, 1)
  assert.deepEqual(order, ['claim', 'send', 'cooldown', 'cooldown'])
  now = state.cooldownUntil + 1
  assert.equal(await sendPending(api, state, { maxMessages: 1 }), 1)
  assert.equal(sends, 2)
})

test('direct Telegram sender retries dirty cooldown persistence before a later API call', async (t) => {
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const failure = new Error('Cooldown store unavailable')
  const order = []
  let writes = 0
  const state = { persistCooldown: async () => {
    order.push('persist')
    writes += 1
    if (writes === 1) throw failure
  } }
  let calls = 0
  const sender = createTelegramSender({ sendMessage: async () => {
    order.push('api')
    calls += 1
    if (calls === 1) throw floodWait(55225)
    return { message_id: calls }
  } }, state, { limiter: { run: (operation) => operation() } })
  await assert.rejects(sender.sendMessage(123, 'first'), (error) => {
    assert.equal(error.cause, failure)
    assert.equal(telegramError(error).code, 429)
    assert.equal(telegramError(error).retryAfterMs, 55225100)
    return true
  })
  assert.equal(state.cooldownDirty, true)
  now = state.cooldownUntil + 1
  await sender.sendMessage(456, 'second')
  assert.deepEqual(order, ['api', 'persist', 'persist', 'api'])
  assert.equal(state.cooldownDirty, false)
})

test('a transient cooldown storage failure retains Telegram long retry_after on the queued delivery', async (t) => {
  const now = Date.now()
  t.mock.method(Date, 'now', () => now)
  t.mock.method(console, 'error', () => {})
  let persistenceAttempts = 0
  const storedUntil = mockCooldownStore(t, async () => {
    persistenceAttempts += 1
    if (persistenceAttempts === 1) throw new Error('Cooldown store unavailable')
  })
  let claims = 0
  t.mock.method(Delivery, 'findOneAndUpdate', async () => { claims += 1; return delivery('delayed') })
  const writes = []
  t.mock.method(Delivery, 'updateOne', async (filter, update) => writes.push({ filter, update }))
  let calls = 0
  const state = await loadDeliveryState()
  const sender = createTelegramSender({ sendMessage: async () => {
    calls += 1
    throw floodWait(55225)
  } }, state, { limiter: { run: (operation) => operation() } })
  assert.equal(await sendPending(sender, state), 0)
  assert.equal(persistenceAttempts, 2)
  assert.equal(state.cooldownDirty, false)
  assert.equal(state.cooldownUntil, now + 55225100)
  assert.equal(storedUntil(), state.cooldownUntil)
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].filter, { _id: 'delayed' })
  assert.equal(writes[0].update.$set.status, 'pending')
  assert.equal(writes[0].update.$set.next_attempt_at.getTime(), state.cooldownUntil)
  assert.equal(await sendPending(sender, state), 0)
  assert.equal(claims, 1)
  assert.equal(calls, 1)
})

test('an accepted message retries only its database acknowledgment on the next cycle', async (t) => {
  let claimed = false
  t.mock.method(Delivery, 'findOneAndUpdate', async () => {
    if (claimed) return null
    claimed = true
    return delivery('accepted')
  })
  const failure = new Error('Acknowledgment unavailable')
  const writes = []
  t.mock.method(Delivery, 'updateOne', async (filter, update) => {
    writes.push({ filter, update })
    if (writes.length === 1) throw failure
  })
  let calls = 0
  const api = { sendMessage: async () => { calls += 1; return { message_id: 7 } } }
  const state = {}
  await assert.rejects(sendPending(api, state), (error) => error === failure)
  assert.equal(calls, 1)
  assert.equal(state.accepted.size, 1)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].update.$set.status, 'sent')
  const originalSentAt = writes[0].update.$set.sent_at
  assert.equal(await sendPending(api, state), 0)
  assert.equal(calls, 1)
  assert.equal(state.accepted.size, 0)
  assert.equal(writes.length, 2)
  assert.equal(writes[1].update.$set.status, 'sent')
  assert.equal(writes[1].update.$set.sent_at, originalSentAt)
  assert.deepEqual(writes.map((write) => write.filter), [{ _id: 'accepted' }, { _id: 'accepted' }])
})

for (const failFirstCommit of [false, true]) {
  test(`parallel accepted messages share one acknowledgment writer${failFirstCommit ? ' and survive its failure' : ''}`, async (t) => {
    const bothAccepted = deferred()
    const acknowledge = deferred()
    const documents = [delivery('first', 123), delivery('second', 456)]
    t.mock.method(Delivery, 'find', () => ({ sort: () => ({ limit: () => ({ select: () => ({
      lean: async () => documents.map(({ chat_id }) => ({ chat_id })),
    }) }) }) }))
    t.mock.method(Delivery, 'findOneAndUpdate', async (query) => documents.find((item) => item.chat_id === query.chat_id))
    const failure = new Error('Acknowledgment unavailable')
    const writes = []
    let activeWrites = 0, maximumWrites = 0
    t.mock.method(Delivery, 'updateOne', async (filter, update) => {
      activeWrites += 1
      maximumWrites = Math.max(maximumWrites, activeWrites)
      writes.push({ id: filter._id, status: update.$set.status })
      try {
        if (writes.length === 1) {
          await acknowledge.promise
          if (failFirstCommit) throw failure
        }
      } finally { activeWrites -= 1 }
    })
    const sentTo = []
    const api = { sendMessage: async (chatId) => {
      sentTo.push(chatId)
      if (sentTo.length === 2) bothAccepted.resolve()
      return { message_id: chatId }
    } }
    const state = {}
    const operation = sendPendingParallel(api, state, { maxMessages: 2, concurrency: 2 })
    await bothAccepted.promise
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(state.accepted.size, 2)
    assert.equal(writes.length, 1)
    acknowledge.resolve()
    if (failFirstCommit) {
      await assert.rejects(operation, (error) => error === failure)
      assert.equal(state.accepted.size, 2)
      t.mock.method(Delivery, 'find', () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [] }) }) }) }))
      assert.equal(await sendPendingParallel(api, state, { maxMessages: 2, concurrency: 2 }), 0)
    } else assert.equal(await operation, 2)
    assert.deepEqual(sentTo, [123, 456])
    assert.equal(maximumWrites, 1)
    assert.equal(state.accepted.size, 0)
    assert.deepEqual(writes, [
      ...(failFirstCommit ? [{ id: 'first', status: 'sent' }] : []),
      { id: 'first', status: 'sent' }, { id: 'second', status: 'sent' },
    ])
  })
}
