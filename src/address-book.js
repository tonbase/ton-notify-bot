const { rawAddress } = require('./address')
const excluded = require('../data/excludedAddresses.json')

const excludedAddresses = new Set(excluded.map(rawAddress).filter(Boolean))
let knownAccounts = new Map()
const labelIndexes = new WeakMap()

function isExcludedTransfer(action) {
  // Preserve the legacy GRAM transfer exclusion without hiding new staking,
  // NFT or jetton action types involving one of these contracts.
  if (action.type !== 'ton_transfer') return false
  return [action.details?.source, action.details?.destination]
    .some((address) => excludedAddresses.has(rawAddress(address)))
}

async function refreshAddressBook(request = fetch) {
  const response = await request('https://address-book.tonscan.org/addresses.json', {
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Address book HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 10000000) throw new Error('Address book exceeds size limit')
  const data = JSON.parse(text)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid address book')
  const next = new Map()
  for (const [key, value] of Object.entries(data)) {
    const address = rawAddress(key)
    const label = typeof value === 'string' ? value : value?.name
    if (address && typeof label === 'string' && label.trim()) next.set(address, label.trim())
  }
  if (!next.size) throw new Error('Empty address book')
  // On timeouts and malformed responses retain the last successful snapshot.
  knownAccounts = next
  return { accounts: next.size }
}

function resolveAccountLabel(watched, address, userId) {
  let tag
  if (userId != null) {
    // A watched snapshot is immutable. Index each account once so a popular
    // subscription cannot turn label lookup into quadratic fanout work.
    let accounts = labelIndexes.get(watched)
    if (!accounts) { accounts = new Map(); labelIndexes.set(watched, accounts) }
    if (!accounts.has(address)) {
      const users = new Map()
      for (const entry of watched.map.get(address) || []) {
        if (entry.tag && !users.has(entry.user_id)) users.set(entry.user_id, entry.tag)
      }
      accounts.set(address, users)
    }
    tag = accounts.get(address).get(userId)
  }
  return tag || knownAccounts.get(address) || null
}

module.exports = { isExcludedTransfer, refreshAddressBook, resolveAccountLabel }
