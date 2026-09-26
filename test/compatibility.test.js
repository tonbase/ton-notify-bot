const test = require('node:test')
const assert = require('node:assert/strict')
const { Address: TonAddress } = require('@ton/core')
const { mongoose, Delivery } = require('../src/models')
const { rawAddress, friendlyAddress } = require('../src/address')
const { parseAddressInput, parseWordFilters, restoreSession } = require('../src/bot')
const { toNano, formatDisplayUnits, scaledInteger } = require('../src/amount')
const { passesFilters, formatNotification } = require('../src/events')
const { routeAction } = require('../src/scanner')
const { config } = require('../src/config')
const { isExcludedTransfer, refreshAddressBook, resolveAccountLabel } = require('../src/address-book')
const excluded = require('../data/excludedAddresses.json')

const A = `0:${'FF'.repeat(32)}`
const B = `0:${'BB'.repeat(32)}`
const record = { _id: 'subscription', user_id: 123, address: A,
  notifications: { is_enabled: true, min_amount: '0', exceptions: [], inclusion: [] } }
const transfer = (value, comment = '') => ({ action_id: 'transfer', type: 'ton_transfer',
  details: { source: A, destination: B, value, comment }, transactions: ['hash'] })

test('all friendly flags, both Base64 alphabets and raw hex normalize to the same account', () => {
  for (const workchain of [-128, -2, -1, 0, 1, 127]) {
    const raw = `${workchain}:${'FF'.repeat(32)}`
    const address = TonAddress.parseRaw(raw)
    for (const bounceable of [false, true]) for (const testOnly of [false, true]) for (const urlSafe of [false, true]) {
      const friendly = address.toString({ bounceable, testOnly, urlSafe })
      assert.equal(rawAddress(friendly), raw)
      assert.equal(rawAddress(parseAddressInput(`${friendly}:tag:with:colons`).address), raw)
      assert.equal(parseAddressInput(`${friendly}:tag:with:colons`).tag, 'tag:with:colons')
    }
    assert.equal(rawAddress(` ${raw.toLowerCase()} `), raw)
    assert.equal(parseAddressInput(`${raw}:tag`).tag, 'tag')
  }
  assert.notEqual(rawAddress(A), rawAddress(A.replace(/^0:/, '-1:')))
  const wide = `256:${'A'.repeat(64)}`
  assert.equal(friendlyAddress(wide), wide, 'never wrap workchain 256 into 0')
})

test('invalid CRC, raw suffixes, workchain overflow and malformed hex are rejected', () => {
  const encoded = friendlyAddress(A)
  for (const invalid of [encoded.slice(0, -1) + (encoded.endsWith('A') ? 'B' : 'A'),
    `${A}:extra`, A.replace('0:', '0oops:'), A.replace('0:', '0.5:'),
    A.replace('0:', '2147483648:'), A.slice(0, -1), A.replace('FF', 'GG')]) {
    assert.equal(rawAddress(invalid), null)
  }
})

test('routing matches each friendly variant against lowercase raw indexer addresses', async (t) => {
  const saved = []
  t.mock.method(Delivery, 'updateOne', async (_filter, update) => { saved.push(update.$setOnInsert) })
  const action = transfer('1')
  action.details.source = A.toLowerCase()
  for (const bounceable of [true, false]) for (const testOnly of [true, false]) for (const urlSafe of [true, false]) {
    const address = TonAddress.parseRaw(A).toString({ bounceable, testOnly, urlSafe })
    const subscription = { ...record, address, tag: 'My wallet' }
    const watched = { map: new Map([[rawAddress(address), [subscription]]]), active: new Set([123]) }
    await routeAction(action, {}, watched)
  }
  assert.equal(saved.length, 8)
  assert.equal(new Set(saved.map((row) => row._id)).size, 1, 'the same subscription and action retain their delivery ID')
  for (const row of saved) assert.match(row.text, /−0\.000000001 GRAM/)
})

test('legacy numeric input and exact amounts do not lose precision', () => {
  for (const value of ['.1', '0.1', '000.100', '1e-1', '0.1000000000']) assert.equal(toNano(value), '100000000')
  assert.equal(toNano('5e9'), '5000000000000000000')
  assert.equal(toNano('1.'), '1000000000')
  assert.equal(toNano('-0'), '0')
  for (const value of ['1e-10', '-1', 'NaN', 'Infinity', '1,5', '1e1000000']) assert.equal(toNano(value), null)
  assert.equal(formatDisplayUnits('123456789012345678901234567890', 18), '123,456,789,012.34567890123456789')
  assert.equal(formatDisplayUnits('10000000001', 9), '10.000000001', 'approved exact display replaces old truncation at 10')
  assert.equal(formatDisplayUnits('1234500', 6), '1.2345')
  assert.equal(formatDisplayUnits('123', 0), '123')
  assert.equal(formatDisplayUnits('1', 255), `0.${'0'.repeat(254)}1`)
})

test('Decimal128 exponent thresholds, boundary equality and invalid amounts are handled explicitly', () => {
  const settings = { notifications: { ...record.notifications, min_amount: mongoose.Types.Decimal128.fromString('1E+9') } }
  assert.equal(scaledInteger(settings.notifications.min_amount), '1000000000')
  assert.equal(formatDisplayUnits(settings.notifications.min_amount), '1')
  assert.equal(passesFilters(settings, transfer('999999999')), false)
  assert.equal(passesFilters(settings, transfer('1000000000')), true)
  assert.equal(passesFilters(settings, transfer('1000000001')), true)
  assert.equal(passesFilters(settings, transfer('not-an-amount')), false)
  settings.notifications.min_amount = 'NaN'
  assert.equal(passesFilters(settings, transfer('1')), false, 'invalid threshold must not enable every notification')
  assert.equal(passesFilters(settings, { type: 'jetton_transfer', details: { amount: '1' } }), true)
})

test('legacy exact comment filters preserve blank comments, newlines and exclusion priority', () => {
  assert.deepEqual(parseWordFilters('+, -ads, cash\nback, +cashback'), { exceptions: ['ads'], inclusion: ['', 'cashback'] })
  const settings = { notifications: { ...record.notifications, ...parseWordFilters('+cashback, -cashback, -') } }
  for (const comment of ['', 'cashback', 'Cashback', 'cashback extra']) assert.equal(passesFilters(settings, transfer('1', comment)), false)
  settings.notifications = { ...record.notifications, ...parseWordFilters('+') }
  assert.equal(passesFilters(settings, transfer('1')), true)
  assert.equal(passesFilters(settings, transfer('1', 'something')), false)
  settings.notifications = { ...record.notifications, ...parseWordFilters('-') }
  assert.equal(passesFilters(settings, transfer('1')), false)
  assert.equal(passesFilters(settings, transfer('1', 'something')), true)
})

test('legacy scene state is resumed once and expired or cleared flows stay cleared', () => {
  for (const [scene, flow] of Object.entries({ editTag: 'tag', editMinAmount: 'amount', editExceptions: 'filters' })) {
    const legacy = { __scenes: { current: scene, state: { address_id: 'a'.repeat(24) } }, language: 'en' }
    assert.deepEqual(restoreSession(legacy), { flow, addressId: 'a'.repeat(24), language: 'en' })
    assert.equal(restoreSession({ ...legacy, flow: null }).flow, null)
    assert.equal(restoreSession({ __scenes: { ...legacy.__scenes, expires: 1 } }).flow, undefined)
  }
})

test('legacy excluded transfers never queue to users or channel, in any address representation', async (t) => {
  t.mock.method(Delivery, 'updateOne', async () => { assert.fail('excluded transfer was queued') })
  const channel = config.channelId
  config.channelId = '-100123'
  try {
    for (const address of excluded) for (const side of ['source', 'destination']) {
      const action = transfer('999999999999999999999')
      action.details[side] = rawAddress(address).toLowerCase()
      assert.equal(isExcludedTransfer(action), true)
      await routeAction(action, {}, { map: new Map([[A, [record]], [B, [record]]]), active: new Set([123]) })
      assert.equal(isExcludedTransfer({ ...action, type: 'stake_deposit' }), false)
    }
  } finally { config.channelId = channel }
})

test('address book names and user tags are normalized, escaped, isolated and survive a failed refresh', async () => {
  await refreshAddressBook(async () => ({ ok: true, text: async () => JSON.stringify({
    [friendlyAddress(B)]: { name: '<Exchange>' }, [A.toLowerCase()]: 'Public wallet',
  }) }))
  const watched = { map: new Map([[B, [{ user_id: 123, tag: 'My savings' }, { user_id: 456, tag: 'Private label' }]]]) }
  assert.equal(resolveAccountLabel(watched, B, 123), 'My savings')
  assert.equal(resolveAccountLabel(watched, B, 789), '<Exchange>')
  assert.equal(resolveAccountLabel(watched, B), '<Exchange>')
  await assert.rejects(refreshAddressBook(async () => ({ ok: false, status: 503 })))
  assert.equal(resolveAccountLabel(watched, B), '<Exchange>')
  const result = formatNotification(transfer('1'), A, record, {}, (address, userId) => resolveAccountLabel(watched, address, userId))
  assert.match(result.text, /My savings/)
  assert.doesNotMatch(result.text, /Private label/)
  const publicResult = formatNotification(transfer('1'), A, null, {}, (address, userId) => resolveAccountLabel(watched, address, userId))
  assert.match(publicResult.text, /&lt;Exchange&gt;/)
  assert.doesNotMatch(publicResult.text, /My savings|Private label/)
})
