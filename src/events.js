const { rawAddress, friendlyAddress, shortAddress } = require('./address')
const { formatDisplayUnits, scaledInteger } = require('./amount')

// Official USDt master: https://tether.to/en/supported-protocols/
const USDT_MASTER = rawAddress('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs')

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

const metadataIndexes = new WeakMap()

function metadataFor(metadata, address) {
  const wanted = rawAddress(address)
  if (!wanted || !metadata || typeof metadata !== 'object') return null
  // Index an immutable provider response once, even when an action fans out
  // to many subscriptions. Weak keys release the index with its response.
  let index = metadataIndexes.get(metadata)
  if (!index) {
    index = new Map()
    for (const candidate of Object.keys(metadata)) {
      const raw = rawAddress(candidate)
      if (raw && !index.has(raw)) index.set(raw, candidate)
    }
    metadataIndexes.set(metadata, index)
  }
  const key = index.get(wanted)
  return key ? metadata[key]?.token_info?.find((info) => info.valid !== false) || null : null
}

function participants(action) {
  const details = action.details || {}
  const values = [
    details.source, details.destination, details.sender, details.receiver,
    details.old_owner, details.new_owner, details.real_old_owner,
    details.owner, details.account, details.contract, details.payer,
    details.beneficiary,
    details.stake_holder, details.pool, details.subscriber, details.bidder, details.auction,
    ...(Array.isArray(action.accounts) ? action.accounts : []),
  ]
  return [...new Set(values.map(rawAddress).filter(Boolean))]
}

function jettonDecimals(token) {
  if (!token) return null
  const value = token.extra?.decimals ?? token.decimals
  // TEP-64 defaults to 9 only when loaded metadata omits this optional field.
  // An unavailable metadata record does not establish a token's precision.
  if (value == null) return 9
  if (!['string', 'number'].includes(typeof value) || !/^\d{1,3}$/.test(String(value))) return null
  const decimals = Number(value)
  return decimals <= 255 ? decimals : null
}

function assetAmount(amount, asset, metadata) {
  if (asset === null) return `${assetIcon(null)}${escapeHtml(formatDisplayUnits(amount || '0'))} GRAM`
  const token = metadataFor(metadata, asset)
  const decimals = jettonDecimals(token)
  const symbol = compactText(token?.symbol || token?.name || 'jetton', 24)
  if (decimals === null) return `${linkAddress(asset, symbol)} (amount unavailable)`
  const quantity = formatDisplayUnits(amount || '0', decimals)
  return `${assetIcon(asset)}${escapeHtml(quantity)} ${linkAddress(asset, symbol)}`
}

function amountText(action, metadata) {
  const details = action.details || {}
  if (action.type === 'ton_transfer') return `💎 ${assetAmount(details.value, null, metadata)}`
  if (['jetton_transfer', 'jetton_mint', 'jetton_burn'].includes(action.type)) {
    return `🪙 ${assetAmount(details.amount, details.asset, metadata)}`
  }
  if (['nft_transfer', 'nft_mint'].includes(action.type)) {
    const token = metadataFor(metadata, details.nft_item)
    const name = String(token?.name || 'NFT')
    const number = name.match(/ #\d{1,12}$/u)?.[0]
    const label = number && Array.from(name).length > 40
      ? compactText(name.slice(0, -number.length), 40 - number.length) + number : compactText(name, 40)
    return `🖼 ${linkAddress(details.nft_item, label)}`
  }
  if (action.type === 'jetton_swap') {
    const incoming = details.dex_incoming_transfer
    const outgoing = details.dex_outgoing_transfer
    if (incoming && outgoing) return `${assetAmount(incoming.amount, incoming.asset, metadata)} → ${assetAmount(outgoing.amount, outgoing.asset, metadata)}`
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
    return details.amount !== undefined ? assetAmount(details.amount, details.asset, metadata) : ''
  }
  if (action.type === 'auction_bid') return assetAmount(details.amount, null, metadata)
  if (['change_dns', 'delete_dns', 'renew_dns'].includes(action.type)) {
    const domain = metadataFor(metadata, details.asset)
    return domain?.name ? linkAddress(details.asset, compactText(domain.name, 40)) : ''
  }
  if (details.value !== undefined && /^\d+$/.test(String(details.value))) {
    return BigInt(details.value) === 0n ? '' : `💎 ${assetAmount(details.value, null, metadata)}`
  }
  if (details.amount !== undefined) return `Amount: ${escapeHtml(details.amount)} base units`
  return ''
}

function actionTitle(action) {
  const titles = {
    ton_transfer: 'GRAM transfer', jetton_transfer: 'Jetton transfer',
    nft_transfer: 'NFT transfer', jetton_mint: 'Mint', jetton_burn: 'Burn',
    nft_mint: 'NFT minted', jetton_swap: 'Swap', contract_deploy: 'Deploy',
    call_contract: 'Contract call', stake_deposit: 'Stake',
    stake_withdrawal: 'Unstake', stake_withdrawal_request: 'Unstake requested',
    dex_deposit_liquidity: 'Add liquidity', dex_withdraw_liquidity: 'Remove liquidity',
    election_deposit: 'Validator deposit', election_recover: 'Validator withdrawal',
    raw_message: 'Blockchain message',
    account_update: 'Account update',
    auction_bid: 'Bid', change_dns: 'DNS updated', delete_dns: 'DNS record deleted',
    renew_dns: 'Domain renewed', tick_tock: 'System operation',
    subscribe: 'Subscription', unsubscribe: 'Subscription cancelled',
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

function assetIcon(asset) {
  // Only the two selected assets from https://t.me/addemoji/CryptoBotAssets.
  // Match USDt by its master contract, never by an untrusted ticker.
  const icon = asset === null ? { id: '5318901904686754959', emoji: '💎' }
    : rawAddress(asset) === USDT_MASTER ? { id: '5406841020769936275', emoji: '💵' } : null
  return icon ? `<tg-emoji emoji-id="${icon.id}">${icon.emoji}</tg-emoji> ` : ''
}

function signedAmount(amount, sign) {
  const icon = amount.match(/^<tg-emoji\b[^>]*>.*?<\/tg-emoji> /u)?.[0] || ''
  const quantity = amount.slice(icon.length)
  return `${icon}${/^\d/u.test(quantity) ? sign : ''}${quantity}`
}

function eventIcon(action, direction) {
  // Static icons: https://t.me/addemoji/BasicinterfaceEmoji
  if (action.success === false) return { emoji: '⚠️', customId: '5370640017037218875' }
  if (['ton_transfer', 'jetton_transfer', 'nft_transfer'].includes(action.type)) {
    if (direction === 'Send') return { emoji: '📤', customId: '5372989093565189720' }
    if (direction === 'Receive') return { emoji: '📥', customId: '5372835488354815966' }
    return direction === 'Self' ? { emoji: '🔁', customId: '5373124754402203769' } : { emoji: '↔️' }
  }
  if (action.type === 'jetton_swap') return { emoji: '🔄', customId: '5373124754402203769' }
  const icons = {
    jetton_mint: { emoji: '✨', customId: '5373351343991836952' },
    nft_mint: { emoji: '✨', customId: '5373351343991836952' },
    jetton_burn: { emoji: '🔥', customId: '5370621922339999779' },
    stake_deposit: { emoji: '🔒', customId: '5371026297805888196' },
    election_deposit: { emoji: '🔒', customId: '5371026297805888196' },
    stake_withdrawal_request: { emoji: '⏳', customId: '5372839044587739624' },
    stake_withdrawal: { emoji: '🔓', customId: '5372989093565189720' },
    election_recover: { emoji: '🔓', customId: '5372989093565189720' },
    dex_deposit_liquidity: { emoji: '➕', customId: '5373351343991836952' },
    dex_withdraw_liquidity: { emoji: '➖', customId: '5370621922339999779' },
    contract_deploy: { emoji: '🛠️', customId: '5372925742797574389' },
    call_contract: { emoji: '⚙️', customId: '5372925742797574389' },
    account_update: { emoji: '⚙️', customId: '5372925742797574389' },
    raw_message: { emoji: '📨', customId: '5373162670373491228' },
    change_dns: { emoji: '⚙️', customId: '5372925742797574389' },
    delete_dns: { emoji: '➖', customId: '5370621922339999779' },
    renew_dns: { emoji: '🔄', customId: '5373124754402203769' },
    tick_tock: { emoji: '⚙️', customId: '5372925742797574389' },
  }
  return icons[action.type] || { emoji: '🔔', customId: '5370648903324554299' }
}

function formatNotification(action, watched, record, metadata = {}, resolveLabel = () => null) {
  const d = action.details || {}
  const stakingIn = ['stake_deposit', 'stake_withdrawal_request'].includes(action.type)
  const stakingOut = action.type === 'stake_withdrawal'
  const source = (action.type === 'nft_transfer' ? d.real_old_owner : null) || d.source || d.sender || d.old_owner || d.bidder
    || (action.type === 'jetton_burn' ? d.owner : stakingIn ? d.stake_holder : stakingOut ? d.pool : null)
  const destination = d.destination || d.receiver || d.new_owner || d.auction
    || (['change_dns', 'delete_dns', 'renew_dns'].includes(action.type) ? d.asset : null)
    || (action.type === 'nft_mint' ? d.owner : stakingIn ? d.pool : stakingOut ? d.stake_holder : null)
  const watchedRaw = rawAddress(watched)
  const direction = rawAddress(source) === watchedRaw && rawAddress(destination) === watchedRaw
    ? 'Self' : rawAddress(source) === watchedRaw ? 'Send'
      : rawAddress(destination) === watchedRaw ? 'Receive' : 'Activity'
  const transfer = ['ton_transfer', 'jetton_transfer', 'nft_transfer'].includes(action.type)
  const briefAddress = (address) => {
    const friendly = friendlyAddress(address)
    return friendly ? `${friendly.slice(0, 5)}…${friendly.slice(-5)}` : compactText(address || 'unknown', 16)
  }
  const party = (address) => {
    const raw = rawAddress(address)
    const label = (raw === watchedRaw && record?.tag) || resolveLabel(raw, record?.user_id)
    return linkAddress(address, label ? compactText(label, 16) : briefAddress(address))
  }
  let route = source && destination && rawAddress(source) !== rawAddress(destination)
    ? `${party(source)} → ${party(destination)}` : party(source || destination || watched)
  if ((source || destination) && ![rawAddress(source), rawAddress(destination)].includes(watchedRaw)) route = `${party(watched)} · ${route}`
  if (direction === 'Self') route += ' · Self'
  if (d.dex || d.provider) {
    const service = String(d.dex || d.provider)
    const providers = { liquid_staking: 'Liquid staking', ethena: 'Ethena', tonco: 'TONCO' }
    const label = /^stonfi(?:_v\d+)?$/i.test(service) ? 'STON.fi'
      : /^dedust(?:_v\d+)?$/i.test(service) ? 'DeDust' : providers[service] || compactText(service, 20)
    route = `${party(watched)} · ${linkAddress(d.pool, label)}`
  }
  const hash = action.transactions?.[0] || action.trace_id
  const transactionUrl = hash ? `https://tonscan.org/transaction/${encodeURIComponent(hash)}` : null
  const transaction = transactionUrl ? ` · <a href="${escapeHtml(transactionUrl)}">tx</a>` : ''
  const amount = amountText(action, metadata).replace(/^(?:💎|🪙|🖼)\s*/u, '')
  let headline
  if (action.success === false) {
    const label = transfer ? `${action.type === 'nft_transfer' ? 'NFT transfer' : 'Transfer'} failed`
      : `${actionTitle(action)} failed`
    // An outgoing swap leg in a failed action must not look like a completed receipt.
    const attempted = action.type === 'jetton_swap' ? (d.dex_incoming_transfer
      ? assetAmount(d.dex_incoming_transfer.amount, d.dex_incoming_transfer.asset, metadata) : '') : amount
    headline = `<b>${escapeHtml(label)}${attempted ? ` · ${attempted}` : ''}</b>`
  } else if (transfer) {
    const sign = direction === 'Send' ? '−' : direction === 'Receive' ? '+' : ''
    if (action.type === 'nft_transfer') {
      const purchase = d.is_purchase && ['Send', 'Receive'].includes(direction)
        ? `${direction === 'Send' ? 'Sold' : 'Bought'} · ` : ''
      const kind = amount.replace(/<[^>]*>/g, '') === 'NFT' ? '' : 'NFT · '
      headline = `<b>${purchase || kind}${amount}</b>`
    } else headline = `<b>${signedAmount(amount, sign)}</b>`
  } else if (action.type === 'jetton_swap') {
    const exchange = amount.replace(/<[^>]*>/g, '').length > 38 ? amount.replace(' → ', '\n→ ') : amount
    headline = `<b>${exchange || 'Swap'}</b>`
  } else {
    headline = `<b>${escapeHtml(actionTitle(action))}</b>${amount ? ` · ${amount}` : ''}`
  }
  const icon = eventIcon(action, direction)
  const lines = [`${icon.emoji} ${headline}`, `${route}${transaction}`]
  const details = []
  // The NFT name opens its item page, which also exposes the collection.
  if (['nft_transfer', 'nft_mint'].includes(action.type) && d.nft_collection && !d.nft_item) details.push(linkAddress(d.nft_collection, 'Collection'))
  if (action.success !== false && d.is_purchase) {
    if (direction === 'Send' && d.payout_amount != null) details.push(`Seller payout: ${assetAmount(d.payout_amount, null, metadata)}`)
    else if (d.price != null) details.push(`Price: ${assetAmount(d.price, null, metadata)}`)
  }
  if (d.pool && !d.dex && !d.provider && ![rawAddress(source), rawAddress(destination)].includes(rawAddress(d.pool))) details.push(linkAddress(d.pool, 'Pool'))
  const comment = d.comment && !d.encrypted && !d.is_encrypted_comment ? String(d.comment) : ''
  // Only presentation is shortened. Filters keep the original comment, and the
  // transaction link exposes the complete reference and precise swap amounts.
  const excerpt = hash ? comment.replace(/\s+Ref#[A-Za-z0-9_-]+$/u, '') : comment
  if (excerpt.trim()) lines.push(`<i>“${escapeHtml(compactText(excerpt, 48))}”</i>`)
  // The text fallback keeps asset tickers readable without custom-emoji support.
  const text = [...lines, ...details].join('\n').replace(/<tg-emoji\b[^>]*>.*?<\/tg-emoji> /gu, '')
  if (!transactionUrl) return { text }
  // Keep the URL button inside one paragraph so the native link does not add
  // a separate button row or spacing between notification lines.
  const richLines = [...lines, ...details]
  if (icon.customId) richLines[0] = `<tg-emoji emoji-id="${icon.customId}">${icon.emoji}</tg-emoji> ${headline}`
  richLines[1] = `${route} <tg-button type="url" url="${escapeHtml(transactionUrl)}">tx</tg-button>`
  return { text, richHtml: `<p>${richLines.join('\n').replaceAll('\n', '<br>')}</p>` }
}

function formatAction(action, watched, record, metadata = {}) {
  return formatNotification(action, watched, record, metadata).text
}

function passesFilters(record, action) {
  const settings = record.notifications || {}
  if (!settings.is_enabled) return false
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

module.exports = { escapeHtml, participants, metadataFor, formatAction, formatNotification, passesFilters }
