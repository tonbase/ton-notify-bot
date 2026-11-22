const { rawAddress } = require('./address')
const { participants } = require('./events')

const FEED_TYPES = [
  'ton_transfer', 'jetton_transfer', 'nft_transfer', 'jetton_swap', 'jetton_mint',
  'jetton_burn', 'nft_mint', 'stake_deposit', 'stake_withdrawal_request', 'stake_withdrawal',
  'dex_deposit_liquidity', 'dex_withdraw_liquidity', 'auction_bid', 'change_dns',
  'delete_dns', 'renew_dns', 'election_deposit', 'election_recover', 'contract_deploy',
  'call_contract', 'tick_tock', 'subscribe', 'unsubscribe', 'other',
]
const technicalTypes = new Set(['excess', 'gasless_request'])

function chooseSample(page, type, state = {}, used = new Set()) {
  const watermark = BigInt(state.lastLt || '0')
  const candidates = []
  for (const original of page.actions || []) {
    if (!original.action_id || used.has(original.action_id)) continue
    if (type === 'other' ? FEED_TYPES.includes(original.type) || technicalTypes.has(original.type) : original.type !== type) continue
    const lt = String(original.end_lt || original.start_lt || '')
    if (!/^\d+$/.test(lt) || BigInt(lt) < watermark) continue
    const action = { ...original }
    if (!participants(action).length && action.transactions_full?.length) {
      action.accounts = [...new Set(action.transactions_full.map(tx => rawAddress(tx.account)).filter(Boolean))]
    }
    const d = action.details || {}
    const source = d.real_old_owner || d.sender || d.source || d.old_owner || d.bidder
    const destination = d.receiver || d.destination || d.new_owner
    const preferred = (state.selected || 0) % 2 ? destination || source : source || destination
    const address = rawAddress(d.stake_holder || d.owner || preferred || d.account) || participants(action)[0]
    if (!address || !(action.transactions?.[0] || action.trace_id)) continue
    candidates.push({ action, address, lt, metadata: page.metadata || {} })
  }
  candidates.sort((a, b) => BigInt(a.lt) > BigInt(b.lt) ? -1 : BigInt(a.lt) < BigInt(b.lt) ? 1 : 0)
  // Periodically include a failed operation if one is newer than the saved cursor.
  return ((state.selected || 0) % 4 === 3 && candidates.find(item => item.action.success === false)) || candidates[0] || null
}

function createPageLoader(client) {
  return async type => {
    if (type === 'tick_tock') {
      // The indexer's expanded tick/tock page can fail while a single action works.
      const page = await client.actions({ action_type: type, supported_action_types: type, limit: 1, sort: 'desc' })
      for (const action of page.actions) {
        if (participants(action).length || !action.transactions?.[0]) continue
        const hash = action.transactions[0]
        const result = await client.get('/transactions', { hash, limit: 1 })
        const tx = result.transactions?.find(item => item.hash === hash)
        const account = rawAddress(tx?.account)
        if (account) action.accounts = [account]
      }
      return page
    }
    return client.actions({ ...(type === 'other' ? {} : { action_type: type }),
      include_accounts: true, limit: 30, sort: 'desc' })
  }
}

module.exports = { FEED_TYPES, chooseSample, createPageLoader }
