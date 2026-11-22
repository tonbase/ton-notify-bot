const test = require('node:test')
const assert = require('node:assert/strict')
const { config } = require('../src/config')
const { Delivery } = require('../src/models')
const { routeAction } = require('../src/notification-router')
const { sendPending } = require('../src/delivery')
const { formatNotification } = require('../src/events')

const A = `0:${'A'.repeat(64)}`, B = `0:${'B'.repeat(64)}`
const action = { action_id: 'channel-transfer', type: 'ton_transfer', transactions: ['hash'],
  details: { source: A, destination: B, value: '50000000000000', comment: 'Reward <test>' } }
const notification = formatNotification(action, A)

test('queued notifications distinguish the channel from private subscribers', async (t) => {
  const previous = { channelId: config.channelId, minChannelTon: config.minChannelTon }
  Object.assign(config, { channelId: '@whales', minChannelTon: '50000' })
  t.after(() => Object.assign(config, previous))
  const queued = []
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => queued.push(update.$setOnInsert))
  const record = { _id: 'address', user_id: 123, address: A, notifications: { is_enabled: true } }
  await routeAction(action, {}, { map: new Map([[A, [record]]]), active: new Set([123]) })
  assert.deepEqual(queued.map(({ chat_id, chat_type }) => ({ chat_id, chat_type })), [
    { chat_id: 123, chat_type: 'private' }, { chat_id: '@whales', chat_type: 'channel' },
  ])
})

for (const scenario of [
  { name: 'channel after its configured destination changes', chatId: '-100123', chatType: 'channel', configured: '@new', standard: true },
  { name: 'legacy channel queue with numeric IDs', chatId: -100123, configured: '-100123', standard: true },
  { name: 'legacy channel queue with a username', chatId: '@whales', configured: '@whales', standard: true },
  { name: 'private chat', chatId: 123, chatType: 'private', configured: '-100123', standard: false },
  { name: 'supergroup with a negative ID', chatId: -100456, chatType: 'supergroup', configured: '-100123', standard: false },
]) {
  test(`batched emoji rendering: ${scenario.name}`, async (t) => {
    const previous = config.channelId
    config.channelId = scenario.configured
    t.after(() => { config.channelId = previous })
    const events = [1, 2].map((n) => ({ _id: `event-${n}`, chat_id: scenario.chatId,
      chat_type: scenario.chatType, text: notification.text, rich_html: notification.richHtml }))
    t.mock.method(Delivery, 'findOneAndUpdate', async () => events.shift() || null)
    const updates = []
    t.mock.method(Delivery, 'updateMany', async (filter, update) => updates.push({ filter, update }))
    let calls = 0
    const sent = await sendPending({ sendRichMessage: async (chat, body) => {
      calls += 1
      assert.equal(chat, scenario.chatId)
      assert.equal(body.skip_entity_detection, true)
      assert.equal((body.html.match(/<tg-button type="url"/g) || []).length, 2)
      assert.equal((body.html.match(scenario.standard ? /<b>50,000 GRAM<\/b>/g : /−50,000 GRAM/g) || []).length, 2)
      assert(body.html.includes('Reward &lt;test&gt;'))
      if (scenario.standard) {
        assert(!body.html.includes('tg-emoji'))
        assert(body.html.includes('<p>📤 <b>50,000 GRAM</b>'))
        assert(!body.html.includes('💎'))
      } else {
        assert.equal(body.html, `${notification.richHtml}\n${notification.richHtml}`)
      }
    } }, {}, { maxMessages: 1, batchSize: 2 })
    assert.equal(sent, 1)
    assert.equal(calls, 1)
    assert.deepEqual(updates[0].filter._id.$in, ['event-1', 'event-2'])
    assert.equal(updates[0].update.$set.status, 'sent')
  })
}

test('channel rich rejection still sends one readable HTML fallback', async (t) => {
  const events = [{ _id: 'channel', chat_id: '-100123', chat_type: 'channel',
    text: notification.text, rich_html: notification.richHtml }]
  const expectedFallback = require('../src/telegram-sender').renderBatch(events, config.channelId).text
  t.mock.method(Delivery, 'findOneAndUpdate', async () => events.shift() || null)
  t.mock.method(Delivery, 'updateOne', async () => {})
  let richCalls = 0, textCalls = 0
  const sent = await sendPending({
    sendRichMessage: async (_chat, body) => {
      richCalls += 1
      assert(!body.html.includes('tg-emoji'))
      throw { error_code: 400, description: 'Rich messages unavailable' }
    },
    sendMessage: async (_chat, text, options) => {
      textCalls += 1
      assert.equal(text, expectedFallback)
      assert(!text.includes('tg-emoji'))
      assert(!text.includes('💎'))
      assert.match(text, /<b>50,000 GRAM<\/b>/u)
      assert.equal(options.parse_mode, 'HTML')
    },
  }, {}, { maxMessages: 1 })
  assert.equal(sent, 1)
  assert.equal(richCalls, 1)
  assert.equal(textCalls, 1)
})

test('channel GRAM amounts lose minus and fractions without changing comments or private alerts', () => {
  const decimal = formatNotification({ ...action,
    details: { ...action.details, value: '50150015727758', comment: 'Invoice 1.234' } }, A,
  null, {}, () => null, '3.35')
  const { renderBatch } = require('../src/telegram-sender')
  const channel = renderBatch([{ chat_id: '@whales', chat_type: 'channel',
    text: decimal.text, rich_html: decimal.richHtml }], '@whales')
  for (const body of [channel.text, channel.richHtml]) {
    assert.match(body, /50,150 GRAM \(≈ \$168,002\)/u)
    assert(!body.includes('💎'))
    assert.match(body, /Invoice 1\.234/u)
    assert.match(body, /https:\/\/tonscan\.org\/transaction\/hash/u)
  }
  const privateMessage = renderBatch([{ chat_id: 123, chat_type: 'private',
    text: decimal.text, rich_html: decimal.richHtml }], '@whales')
  assert.match(privateMessage.richHtml, /💎<\/tg-emoji> −50,150\.015727758 GRAM \(≈ \$168,002\.55\)/u)
  const legacy = renderBatch([{ chat_id: '@whales', chat_type: 'channel',
    text: '<p>📤 <b>-12.75 GRAM (≈ $20.40)</b></p>', rich_html: null }], '@whales')
  assert.equal(legacy.text, '<p>📤 <b>12 GRAM (≈ $20)</b></p>')
})
