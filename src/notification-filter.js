const { config } = require('./config')
const { rawAddress } = require('./address')
const { scaledInteger } = require('./amount')

// Filter only confirmed incoming native transfers. A contract's attached GRAM
// value says nothing about the value of a jetton, NFT, swap or failed action.
function isIncomingDust(record, action) {
  if (record.notifications?.filter_dust === false || action?.type !== 'ton_transfer'
    || action.success !== true) return false
  const watched = rawAddress(record.address)
  const source = rawAddress(action.details?.source)
  const destination = rawAddress(action.details?.destination)
  if (!watched || !source || destination !== watched || source === watched) return false
  const value = scaledInteger(action.details?.value)
  return value !== null && BigInt(value) < BigInt(config.minIncomingGramNano)
}

function passesFilters(record, action) {
  const settings = record.notifications || {}
  if (!settings.is_enabled) return false
  if (isIncomingDust(record, action)) return false
  const comment = String(action.details?.comment || '')
  if ((settings.exceptions || []).includes(comment)) return false
  if ((settings.inclusion || []).length && !(settings.inclusion || []).includes(comment)) return false
  if (action.type === 'ton_transfer') {
    const value = scaledInteger(action.details?.value ?? '0')
    const minimum = scaledInteger(settings.min_amount ?? '0')
    return value !== null && minimum !== null && BigInt(value) >= BigInt(minimum)
  }
  return true
}

function filterAction(action) {
  if (action.type !== 'ton_transfer') return undefined
  const { source, destination, value } = action.details || {}
  return { type: action.type, success: action.success, details: { source, destination, value } }
}

module.exports = { isIncomingDust, passesFilters, filterAction }
