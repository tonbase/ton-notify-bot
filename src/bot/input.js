const { rawAddress } = require('../address')
const { domainName } = require('../dns')

function parseAddressInput(input) {
  const match = String(input || '').trim().match(/^(-?\d+:[a-fA-F0-9]{64}|[a-zA-Z0-9+/_-]{48}|[a-zA-Z0-9.-]+\.(?:ton|grm))(?::([^\r\n]+))?$/i)
  if (!match) return null
  const address = rawAddress(match[1]) ? match[1] : domainName(match[1])
  return address ? { address, tag: (match[2] || '').trim() } : null
}

function parseWordFilters(text) {
  const exceptions = new Set()
  const inclusion = new Set()
  for (const raw of text.split(',')) {
    const trimmed = raw.trim().replace(/\r?\n/g, '')
    const word = trimmed.replace(/^[+-]/, '').trim()
    if (trimmed.startsWith('-')) exceptions.add(word)
    else inclusion.add(word)
  }
  return { exceptions: [...exceptions], inclusion: [...inclusion] }
}

module.exports = { parseAddressInput, parseWordFilters }
