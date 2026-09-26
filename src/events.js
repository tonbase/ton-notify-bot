const { rawAddress, friendlyAddress, shortAddress } = require('./address')
const { formatUnits } = require('./amount')

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

function metadataFor(metadata, address) {
  const wanted = rawAddress(address)
  if (!wanted || !metadata) return null
  const key = Object.keys(metadata).find((candidate) => rawAddress(candidate) === wanted)
  return key ? metadata[key]?.token_info?.find((info) => info.valid !== false) || null : null
}

function participants(action) {
  const details = action.details || {}
  const values = [
    details.source, details.destination, details.sender, details.receiver,
    details.old_owner, details.new_owner, details.real_old_owner,
    details.owner, details.account, details.contract, details.payer,
    details.beneficiary,
    details.stake_holder, details.pool, details.subscriber,
    ...(Array.isArray(action.accounts) ? action.accounts : []),
  ]
  return [...new Set(values.map(rawAddress).filter(Boolean))]
}

function assetAmount(amount, asset, metadata, knownTon = false) {
  if (knownTon || asset === null) return `${escapeHtml(formatUnits(amount || '0'))} TON`
  const token = metadataFor(metadata, asset)
  const decimalsValue = token?.extra?.decimals ?? token?.decimals
  const decimals = decimalsValue === undefined ? null : Number(decimalsValue)
  const symbol = compactText(token?.symbol || token?.name || 'jetton', 24)
  const quantity = Number.isInteger(decimals) && decimals >= 0 && decimals <= 30
    ? formatUnits(amount || '0', decimals, decimals) : `${amount || '0'} base units`
  return `${escapeHtml(quantity)} ${linkAddress(asset, symbol)}`
}

function amountText(action, metadata) {
  const details = action.details || {}
  if (action.type === 'ton_transfer') return `💎 ${escapeHtml(formatUnits(details.value || '0'))} TON`
  if (['jetton_transfer', 'jetton_mint', 'jetton_burn'].includes(action.type)) {
    return `🪙 ${assetAmount(details.amount, details.asset, metadata)}`
  }
  if (['nft_transfer', 'nft_mint'].includes(action.type)) {
    const token = metadataFor(metadata, details.nft_item)
    const name = token?.name || 'NFT'
    return `🖼 ${linkAddress(details.nft_item, compactText(name, 64))}`
  }
  if (action.type === 'jetton_swap') {
    const incoming = details.dex_incoming_transfer
    const outgoing = details.dex_outgoing_transfer
    if (incoming && outgoing) return `🪙 ${assetAmount(incoming.amount, incoming.asset, metadata)} → ${assetAmount(outgoing.amount, outgoing.asset, metadata)}`
    return incoming ? `Out: ${assetAmount(incoming.amount, incoming.asset, metadata)}`
      : outgoing ? `In: ${assetAmount(outgoing.amount, outgoing.asset, metadata)}` : ''
  }
  if (['dex_deposit_liquidity', 'dex_withdraw_liquidity'].includes(action.type)) {
    return `🪙 ${[1, 2].filter((index) => details[`amount_${index}`] !== undefined)
      .map((index) => assetAmount(details[`amount_${index}`], details[`asset_${index}`], metadata)).join(' + ')}`
  }
  if (['stake_deposit', 'stake_withdrawal', 'election_deposit', 'election_recover'].includes(action.type)) {
    return `💎 ${assetAmount(details.amount, null, metadata)}`
  }
  if (action.type === 'stake_withdrawal_request') {
    return details.amount !== undefined ? `Requested: ${assetAmount(details.amount, details.asset, metadata)}` : ''
  }
  if (details.value !== undefined && /^\d+$/.test(String(details.value))) {
    return `💎 ${escapeHtml(formatUnits(details.value))} TON`
  }
  if (details.amount !== undefined) return `Amount: ${escapeHtml(details.amount)} base units`
  return ''
}

function actionTitle(action) {
  const titles = {
    ton_transfer: 'TON transfer', jetton_transfer: 'Jetton transfer',
    nft_transfer: 'NFT transfer', jetton_mint: 'Mint', jetton_burn: 'Burn',
    nft_mint: 'Mint', jetton_swap: 'Swap', contract_deploy: 'Deploy',
    call_contract: 'Contract call', stake_deposit: 'Stake',
    stake_withdrawal: 'Unstake', stake_withdrawal_request: 'Request unstake',
    dex_deposit_liquidity: 'Add liquidity', dex_withdraw_liquidity: 'Remove liquidity',
    election_deposit: 'Validator deposit', election_recover: 'Validator withdrawal',
    raw_message: 'Blockchain message',
    account_update: 'Account update',
  }
  return titles[action.type] || compactText(String(action.type || 'Blockchain event').replaceAll('_', ' '), 40)
}

function compactText(value, limit) {
  const characters = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim())
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : characters.join('')
}

function linkAddress(address, label) {
  const friendly = friendlyAddress(address)
  if (!friendly) return escapeHtml(label || String(address || 'unknown'))
  return `<a href="https://tonscan.org/address/${encodeURIComponent(friendly)}">${escapeHtml(label || shortAddress(address))}</a>`
}

function formatAction(action, watched, record, metadata = {}) {
  const d = action.details || {}
  const stakingIn = ['stake_deposit', 'stake_withdrawal_request'].includes(action.type)
  const stakingOut = action.type === 'stake_withdrawal'
  const source = d.source || d.sender || d.real_old_owner || d.old_owner
    || (action.type === 'jetton_burn' ? d.owner : stakingIn ? d.stake_holder : stakingOut ? d.pool : null)
  const destination = d.destination || d.receiver || d.new_owner
    || (action.type === 'nft_mint' ? d.owner : stakingIn ? d.pool : stakingOut ? d.stake_holder : null)
  const watchedRaw = rawAddress(watched)
  const direction = rawAddress(source) === watchedRaw && rawAddress(destination) === watchedRaw
    ? 'Self' : rawAddress(source) === watchedRaw ? 'Send'
      : rawAddress(destination) === watchedRaw ? 'Receive' : 'Activity'
  const transfer = ['ton_transfer', 'jetton_transfer', 'nft_transfer'].includes(action.type)
  const title = transfer && direction !== 'Activity' ? direction : actionTitle(action)
  const icon = action.success === false ? '⚠️' : action.type === 'jetton_swap' ? '🔄'
    : direction === 'Send' ? '📤' : direction === 'Receive' ? '📥' : '🔔'
  const tag = record?.tag ? compactText(record.tag, 24) : shortAddress(watched)
  const party = (address) => linkAddress(address, rawAddress(address) === watchedRaw ? tag : undefined)
  let route = source && destination && rawAddress(source) !== rawAddress(destination)
    ? `${party(source)} → ${party(destination)}` : party(source || destination || watched)
  if ((source || destination) && ![rawAddress(source), rawAddress(destination)].includes(watchedRaw)) route = `${party(watched)} · ${route}`
  const hash = action.transactions?.[0] || action.trace_id
  const transaction = hash ? ` · <a href="https://tonscan.org/transaction/${encodeURIComponent(hash)}">tx ↗</a>` : ''
  const heading = `${icon} <b>${action.success === false ? 'Failed · ' : ''}${escapeHtml(title)}</b> ${route}${transaction}`
  const lines = [heading]
  const amount = amountText(action, metadata)
  const details = [amount]
  if (d.nft_collection) details.push(linkAddress(d.nft_collection, 'collection'))
  if (d.is_purchase && d.payout_amount) details.push(`Seller payout: ${assetAmount(d.payout_amount, null, metadata)}`)
  if (d.dex || d.provider) details.push(linkAddress(d.pool, compactText(d.dex || d.provider, 24)))
  else if (d.pool && ![rawAddress(source), rawAddress(destination)].includes(rawAddress(d.pool))) details.push(linkAddress(d.pool, 'pool'))
  if (details.some(Boolean)) lines.push(details.filter(Boolean).join(' · '))
  const comment = d.comment
  if (comment && !d.encrypted && !d.is_encrypted_comment) {
    lines.push(`💬 ${escapeHtml(compactText(comment, 160))}`)
  }
  return lines.join('\n')
}

function passesFilters(record, action) {
  const settings = record.notifications || {}
  if (!settings.is_enabled) return false
  const comment = String(action.details?.comment || '')
  if ((settings.exceptions || []).includes(comment)) return false
  if ((settings.inclusion || []).length && !(settings.inclusion || []).includes(comment)) return false
  if (action.type === 'ton_transfer') {
    try {
      return BigInt(action.details?.value || '0') >= BigInt(String(settings.min_amount || '0'))
    } catch { return true }
  }
  return true
}

module.exports = { escapeHtml, participants, metadataFor, formatAction, passesFilters }
