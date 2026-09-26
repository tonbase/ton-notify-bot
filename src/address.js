const { Address } = require('@ton/core')

function rawAddress(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return Address.parse(value.trim()).toRawString().toUpperCase()
  } catch {
    return null
  }
}

function friendlyAddress(value) {
  const raw = rawAddress(value)
  if (!raw) return null
  return Address.parseRaw(raw).toString({ urlSafe: true, bounceable: false })
}

function shortAddress(value) {
  const friendly = friendlyAddress(value) || value || 'unknown'
  return friendly.length > 16 ? `${friendly.slice(0, 7)}…${friendly.slice(-6)}` : friendly
}

module.exports = { rawAddress, friendlyAddress, shortAddress }
