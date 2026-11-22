const { rawAddress, friendlyAddress, shortAddress } = require('./address')
const { scaledInteger, formatDisplayUnits } = require('./amount')
const { escapeHtml, metadataFor, jettonDecimals, formatNotification } = require('./events')

const compact = (value, limit = 24) => Array.from(String(value || '').replace(/\s+/gu, ' ').trim()).slice(0, limit).join('')
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const time = (utime) => new Date(utime * 1000).toISOString().slice(11, 16)
const walletUrl = (address) => `https://tonscan.org/address/${encodeURIComponent(friendlyAddress(address))}`
const transactionUrl = (event) => event.transaction_hash
  ? `https://tonscan.org/transaction/${encodeURIComponent(event.transaction_hash)}` : null
const txLink = (event) => transactionUrl(event) ? ` · <a href="${transactionUrl(event)}">tx</a>` : ''

function snapshotEvent(action, address, metadata = {}, resolveLabel = () => null, utime = action.start_utime) {
  const details = action.details || {}
  const source = rawAddress(details.source || details.sender)
  const destination = rawAddress(details.destination || details.receiver)
  const watched = rawAddress(address)
  const transfer = ['ton_transfer', 'jetton_transfer'].includes(action.type)
  const native = action.type === 'ton_transfer'
  const token = native ? null : metadataFor(metadata, details.asset)
  const asset = native ? null : rawAddress(details.asset)
  return {
    type: action.type, success: action.success, utime,
    direction: transfer && source === watched && destination === watched ? 'self'
      : transfer && source === watched ? 'out' : transfer && destination === watched ? 'in' : 'other',
    source, destination, source_label: compact(resolveLabel(source), 64), destination_label: compact(resolveLabel(destination), 64),
    asset, amount: transfer ? scaledInteger(native ? details.value : details.amount) : null,
    decimals: native ? 9 : asset ? jettonDecimals(token) : null,
    symbol: native ? 'GRAM' : compact(token?.symbol || token?.name || 'jetton'),
    transaction_hash: action.transactions?.[0] || action.trace_id,
    text: formatNotification(action, address, null, metadata, resolveLabel).text,
  }
}

function party(address, publicLabel, labels = new Map()) {
  if (!friendlyAddress(address)) return escapeHtml(compact(publicLabel || 'unknown'))
  const label = compact(labels.get(rawAddress(address)) || publicLabel || shortAddress(address))
  return `<a href="${walletUrl(address)}">${escapeHtml(label)}</a>`
}

function assetLabel(event) {
  if (event.type === 'ton_transfer' || event.asset === 'native') return 'GRAM'
  const symbol = escapeHtml(compact(event.display_symbol || event.symbol || 'jetton', 64))
  return friendlyAddress(event.asset) ? `<a href="${walletUrl(event.asset)}">${symbol}</a>` : symbol
}

function amountLabel(event) {
  const amount = scaledInteger(event.amount)
  const known = amount !== null && Number.isInteger(event.decimals) && event.decimals >= 0 && event.decimals <= 255
  return `${known ? escapeHtml(formatDisplayUnits(amount, event.decimals)) : 'amount unavailable'} ${assetLabel(event)}`
}

const ordered = (events) => [...events].sort((a, b) => b.utime - a.utime || String(a._id).localeCompare(String(b._id)))

function collectTotals(events) {
  const counts = { out: 0, in: 0, self: 0, swaps: 0, nft: 0, failed: 0, other: 0 }
  const totals = { out: new Map(), in: new Map() }
  for (const event of events) {
    if (event.success === false) { counts.failed++; continue }
    if (event.type === 'jetton_swap') { counts.swaps++; continue }
    if (event.type?.startsWith('nft_')) { counts.nft++; continue }
    if (event.success !== true || !['ton_transfer', 'jetton_transfer'].includes(event.type)) { counts.other++; continue }
    if (event.direction === 'self') { counts.self++; continue }
    if (!totals[event.direction]) { counts.other++; continue }
    counts[event.direction]++
    // Contract identity keeps unrelated tokens with the same ticker separate.
    const key = event.type === 'ton_transfer' ? 'native' : event.asset || 'unknown-jetton'
    const group = totals[event.direction].get(key) || { ...event, asset: key === 'native' ? 'native' : event.asset,
      sum: 0n, decimals: null, known: false, partial: false }
    const amount = scaledInteger(event.amount)
    if (amount === null || !Number.isInteger(event.decimals) || event.decimals < 0 || event.decimals > 255) {
      group.partial = true
    } else {
      const decimals = Math.max(group.decimals ?? 0, event.decimals)
      group.sum = group.sum * 10n ** BigInt(decimals - (group.decimals ?? decimals))
        + BigInt(amount) * 10n ** BigInt(decimals - event.decimals)
      group.decimals = decimals
      group.known = true
    }
    totals[event.direction].set(key, group)
  }
  return { counts, totals }
}

function totalLine(groups) {
  const sorted = [...groups.values()].sort((a, b) => (a.asset === 'native' ? -1 : b.asset === 'native' ? 1
    : a.symbol.localeCompare(b.symbol) || String(a.asset).localeCompare(String(b.asset))))
  const parts = []
  for (const group of sorted.slice(0, 3)) {
    if (sorted.filter((other) => other.symbol === group.symbol).length > 1 && group.asset !== 'native') {
      group.display_symbol = `${group.symbol} (${shortAddress(group.asset)})`
    }
    const value = group.known ? `${formatDisplayUnits(group.sum.toString(), group.decimals)}${group.partial ? ' + ?' : ''}` : 'amount unavailable'
    const part = `${escapeHtml(value)} ${assetLabel(group)}`
    if ([...parts, part].join(' · ').length > 1000) break
    parts.push(part)
  }
  const remaining = sorted.length - parts.length
  if (remaining) parts.push(parts.length ? `+ ${remaining} assets in All operations` : 'Amounts in All operations')
  return parts.join(' · ')
}

function heading(delivery, contents) {
  const start = new Date(delivery.digest.window_start).toISOString().slice(11, 16)
  const end = new Date(delivery.digest.window_end).toISOString().slice(11, 16)
  return `📊 ${party(delivery.digest.address, contents.tag, contents.labels)} · ${start}–${end} UTC`
}

function renderSummary(delivery, contents) {
  const { counts, totals } = collectTotals(contents.events)
  const lines = [heading(delivery, contents), `<b>${plural(contents.events.length, 'event')}</b>`]
  for (const [direction, title] of [['out', '📤 Sent'], ['in', '📥 Received']]) {
    if (counts[direction]) lines.push('', `<b>${title} · ${plural(counts[direction], 'transfer')}</b>`, totalLine(totals[direction]))
  }
  const recent = ordered(contents.events).filter((event) => event.success === true
    && ['ton_transfer', 'jetton_transfer'].includes(event.type) && event.direction === 'out').slice(0, 5)
  let shown = 0
  if (recent.length) lines.push('', '<b>Latest sends</b>')
  for (const event of recent) {
    const line = `${time(event.utime)} · <b>${amountLabel(event)}</b> → ${party(event.destination, event.destination_label, contents.labels)}${txLink(event)}`
    if ([...lines, line].join('\n').length > 3100) break
    lines.push(line)
    shown++
  }
  if (recent.length && !shown) lines.splice(-2)
  if (counts.out > shown) lines.push(`${plural(counts.out - shown, 'more send')} in All operations`)
  const categories = [['swaps', '🔄', 'swap'], ['nft', '🖼', 'NFT', 'NFT'], ['failed', '⚠️', 'failed', 'failed'],
    ['self', '🔁', 'self transfer'], ['other', '🔔', 'other event']]
    .filter(([key]) => counts[key]).map(([key, icon, one, many]) => `${icon} ${plural(counts[key], one, many)}`)
  if (categories.length) lines.push('', categories.join(' · '))
  return lines.join('\n')
}

function callbackData(delivery, page) {
  return `dg:${delivery.address_id}:${Math.floor(+new Date(delivery.digest.window_start) / 1000)}:${page}`
}

function summaryKeyboard(delivery, complete) {
  const buttons = []
  if (complete && /^[a-f0-9]{24}$/iu.test(delivery.address_id)) buttons.push({ text: 'All operations', callback_data: callbackData(delivery, 0) })
  buttons.push({ text: 'Open wallet', url: walletUrl(delivery.digest.address) })
  return { inline_keyboard: [buttons] }
}

function renderEvent(event, labels) {
  if (event.success === true && ['ton_transfer', 'jetton_transfer'].includes(event.type)) {
    const icon = { out: '📤', in: '📥', self: '🔁' }[event.direction] || '↔️'
    return `${time(event.utime)} UTC · ${icon} <b>${amountLabel(event)}</b>\n${party(event.source, event.source_label, labels)} → ${party(event.destination, event.destination_label, labels)}${txLink(event)}`
  }
  return `${time(event.utime)} UTC\n${event.text}`
}

function renderDigestPage(delivery, contents, requestedPage = 0) {
  const pages = [[]]
  for (const event of ordered(contents.events)) {
    let text = renderEvent(event, contents.labels)
    if (text.length > 2500) text = `${time(event.utime)} UTC · ${escapeHtml(compact(event.type?.replaceAll('_', ' '), 40))}${txLink(event)}\nOpen transaction for full details.`
    if ([...pages.at(-1), text].join('\n\n').length > 2800) pages.push([])
    pages.at(-1).push(text)
  }
  const page = Math.max(0, Math.min(pages.length - 1, Number.isSafeInteger(requestedPage) ? requestedPage : 0))
  const nav = []
  if (page > 0) nav.push({ text: '« Prev', callback_data: callbackData(delivery, page - 1) })
  if (page + 1 < pages.length) nav.push({ text: 'Next »', callback_data: callbackData(delivery, page + 1) })
  const keyboard = nav.length ? [nav] : []
  keyboard.push([{ text: '« Summary', callback_data: callbackData(delivery, 's') },
    { text: 'Open wallet', url: walletUrl(delivery.digest.address) }])
  return { text: `${heading(delivery, contents)}\n<b>All operations · ${page + 1}/${pages.length}</b>\n\n${pages[page].join('\n\n')}`,
    reply_markup: { inline_keyboard: keyboard }, page, pages: pages.length }
}

module.exports = { snapshotEvent, collectTotals, renderSummary, summaryKeyboard, renderDigestPage }
