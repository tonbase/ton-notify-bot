const { Address } = require('@ton/core')

function rawAddress(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const input = value.trim()
  try {
    // Validate the entire raw value: the SDK accepts suffixes and partial IDs.
    if (input.includes(':')) {
      if (!/^-?\d+:[a-fA-F0-9]{64}$/.test(input)) return null
      const workchain = Number(input.split(':')[0])
      if (!Number.isInteger(workchain) || workchain < -2147483648 || workchain > 2147483647) return null
      return Address.parseRaw(input).toRawString().toUpperCase()
    }
    const { address } = Address.parseFriendly(input)
    const workchain = Buffer.from(input, 'base64').readInt8(1)
    return new Address(workchain, address.hash).toRawString().toUpperCase()
  } catch {
    return null
  }
}

function friendlyAddress(value) {
  const raw = rawAddress(value)
  if (!raw) return null
  const address = Address.parseRaw(raw)
  // A workchain outside int8 cannot be represented by a friendly address.
  return address.workChain < -128 || address.workChain > 127 ? raw
    : address.toString({ urlSafe: true, bounceable: false })
}

function shortAddress(value) {
  const friendly = friendlyAddress(value) || value || 'unknown'
  return friendly.length > 16 ? `${friendly.slice(0, 7)}…${friendly.slice(-6)}` : friendly
}

module.exports = { rawAddress, friendlyAddress, shortAddress }
