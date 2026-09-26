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
    ...(Array.isArray(action.accounts) ? action.accounts : []),
  ]
  return [...new Set(values.map(rawAddress).filter(Boolean))]
}

function amountText(action, metadata) {
  const details = action.details || {}
  if (action.type === 'ton_transfer') return `💎 ${escapeHtml(formatUnits(details.value || '0'))} TON`
  if (action.type === 'jetton_transfer') {
    const token = metadataFor(metadata, details.asset)
    const decimalsValue = token?.extra?.decimals ?? token?.decimals
    const decimals = decimalsValue === undefined ? null : Number(decimalsValue)
    const symbol = String(token?.symbol || token?.name || 'jetton').slice(0, 48)
    const quantity = Number.isInteger(decimals) && decimals >= 0 && decimals <= 30
      ? formatUnits(details.amount || '0', decimals, decimals)
      : `${details.amount || '0'} base units`
    return `🪙 ${escapeHtml(quantity)} ${escapeHtml(symbol)}`
  }
  if (action.type === 'nft_transfer') {
    const token = metadataFor(metadata, details.nft_item)
    const name = token?.name || 'NFT'
    return `🖼 ${escapeHtml(String(name).slice(0, 80))}`
  }
  if (details.value !== undefined && /^\d+$/.test(String(details.value))) {
    return `💎 ${escapeHtml(formatUnits(details.value))} TON`
  }
  if (details.amount !== undefined) return `Amount: ${escapeHtml(details.amount)}`
  return ''
}

function actionTitle(action) {
  const titles = {
    ton_transfer: 'TON transfer', jetton_transfer: 'Jetton transfer',
    nft_transfer: 'NFT transfer', jetton_mint: 'Jetton mint', jetton_burn: 'Jetton burn',
    nft_mint: 'NFT mint', jetton_swap: 'Token swap', contract_deploy: 'Contract deployed',
    call_contract: 'Contract call', stake_deposit: 'Stake deposit',
    withdraw_stake: 'Stake withdrawal', raw_message: 'Blockchain message',
    account_update: 'Account update',
  }
  return titles[action.type] || String(action.type || 'Blockchain event').replaceAll('_', ' ')
}

function linkAddress(address, label) {
  const friendly = friendlyAddress(address)
  if (!friendly) return escapeHtml(label || String(address || 'unknown'))
  return `<a href="https://tonscan.org/address/${encodeURIComponent(friendly)}">${escapeHtml(label || shortAddress(address))}</a>`
}

function formatAction(action, watched, record, metadata = {}) {
  const d = action.details || {}
  const source = d.source || d.sender || d.old_owner || d.real_old_owner
  const destination = d.destination || d.receiver || d.new_owner
  const watchedRaw = rawAddress(watched)
  const direction = rawAddress(source) === watchedRaw && rawAddress(destination) === watchedRaw
    ? 'Self' : rawAddress(source) === watchedRaw ? 'Sent'
      : rawAddress(destination) === watchedRaw ? 'Received' : 'Activity'
  const heading = `${action.success === false ? '⚠️ Failed' : direction === 'Sent' ? '📤' : direction === 'Received' ? '📥' : '🔔'} <b>${escapeHtml(actionTitle(action))}</b> · ${direction}`
  const tag = record?.tag ? String(record.tag).slice(0, 100) : shortAddress(watched)
  const lines = [heading, `👁 ${linkAddress(watched, tag)}`]
  if (source) lines.push(`From: ${linkAddress(source)}`)
  if (destination) lines.push(`To: ${linkAddress(destination)}`)
  const amount = amountText(action, metadata)
  if (amount) lines.push(amount)
  if (action.type === 'jetton_transfer' && d.asset) lines.push(`Token: ${linkAddress(d.asset)}`)
  if (action.type === 'nft_transfer' && d.nft_item) lines.push(`Item: ${linkAddress(d.nft_item)}`)
  const comment = d.comment
  if (comment && !d.encrypted && !d.is_encrypted_comment) {
    lines.push(`💬 ${escapeHtml(String(comment).slice(0, 500))}`)
  }
  const hash = action.transactions?.[0] || action.trace_id
  if (hash) lines.push(`<a href="https://tonscan.org/transaction/${encodeURIComponent(hash)}">Open transaction ↗</a>`)
  return lines.join('\n')
}

function passesFilters(record, action) {
  const settings = record.notifications || {}
  if (!settings.is_enabled) return false
  const comment = String(action.details?.comment || '')
  if ((settings.exceptions || []).some((word) => word && comment.includes(word))) return false
  if ((settings.inclusion || []).length && !(settings.inclusion || []).some((word) => word && comment.includes(word))) return false
  if (action.type === 'ton_transfer') {
    try {
      return BigInt(action.details?.value || '0') >= BigInt(String(settings.min_amount || '0'))
    } catch { return true }
  }
  return true
}

module.exports = { escapeHtml, participants, metadataFor, formatAction, passesFilters }
