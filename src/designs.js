const { formatAction, escapeHtml } = require('./events')
const { friendlyAddress, shortAddress } = require('./address')

const REVISION = 'r2'
// Synthetic fixtures: no recipient identity, credentials or private wallet data.
const wallet = `0:${'1'.repeat(64)}`
const peer = `0:${'2'.repeat(64)}`
const token = `0:${'3'.repeat(64)}`
const nft = `0:${'4'.repeat(64)}`
const collection = `0:${'5'.repeat(64)}`
const explorer = 'https://tonscan.org'
const link = (text, url) => `<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`
const addressUrl = (address) => `${explorer}/address/${friendlyAddress(address)}`
const ownLink = link('Main wallet', addressUrl(wallet))
const peerLink = link(shortAddress(peer), addressUrl(peer))
const tokenLink = link('USDT', addressUrl(token))
const nftLink = link('Astral Shard #1042', addressUrl(nft))
const metadata = {
  [token]: { token_info: [{ symbol: 'USDT', extra: { decimals: '6' } }] },
  [nft]: { token_info: [{ name: 'Astral Shard #1042' }] },
}

const CASES = [
  { id: 'ton', label: 'TON', title: 'Received', icon: '📥', value: '+12.345 TON',
    amount: '+12.345 TON', detail: 'From', peer: peerLink, incoming: true, comment: 'Payment for order #2048',
    action: { type: 'ton_transfer', success: true, details: { source: peer, destination: wallet, value: '12345000000', comment: 'Payment for order #2048' } } },
  { id: 'usdt', label: 'USDT', title: 'Received', icon: '📥', value: '+125.50 USDT',
    amount: `+125.50 ${tokenLink}`, detail: 'From', peer: peerLink, incoming: true, comment: 'Payment for order #2048',
    action: { type: 'jetton_transfer', success: true, details: { sender: peer, receiver: wallet, asset: token, amount: '125500000', comment: 'Payment for order #2048' } } },
  { id: 'nft', label: 'NFT', title: 'NFT received', icon: '🖼', value: 'Astral Shard #1042',
    amount: nftLink, detail: 'From', peer: peerLink, incoming: true, comment: '',
    action: { type: 'nft_transfer', success: true, details: { old_owner: peer, new_owner: wallet, nft_item: nft, nft_collection: collection } } },
  { id: 'swap', label: 'Swap', title: 'Swap', icon: '🔄', value: '25 USDT → 8.123 TON',
    amount: `25 ${tokenLink} → 8.123 TON`, detail: 'DEX', peer: 'STON.fi', incoming: false, comment: '',
    action: { type: 'jetton_swap', success: true, details: { sender: wallet, dex: 'STON.fi',
      dex_incoming_transfer: { amount: '25000000', asset: token }, dex_outgoing_transfer: { amount: '8123000000', asset: null } } } },
  { id: 'failed', label: 'Ошибка', title: 'Transfer failed', icon: '⚠️', value: '25 USDT · not sent',
    amount: `25 ${tokenLink} · not sent`, detail: 'To', peer: peerLink, incoming: false,
    comment: 'Insufficient TON for network fees',
    action: { type: 'jetton_transfer', success: false, details: { sender: wallet, receiver: peer, asset: token, amount: '25000000' } } },
]

const PREVIOUS_DESIGNS = [
  { id: 'a', label: 'A · Классика', mode: 'text', description: 'Текущий компактный шаблон: направление, адреса, сумма.' },
  { id: 'b', label: 'B · Сумма первой', mode: 'text', description: 'Главный акцент — изменение актива, затем кошелёк.' },
  { id: 'c', label: 'C · Минимализм', mode: 'text', description: 'Без эмодзи; спокойная типографика и две строки.' },
  { id: 'd', label: 'D · Цитата', mode: 'text', description: 'Сумма и контрагент сгруппированы нативной цитатой.' },
  { id: 'e', label: 'E · Раскрытие', mode: 'rich', description: 'Краткое резюме и сворачиваемые подробности.' },
  { id: 'f', label: 'F · Таблица', mode: 'rich', description: 'Компактная нативная таблица с ровными колонками.' },
  { id: 'g', label: 'G · Заголовок', mode: 'rich', description: 'Крупная сумма, участники и небольшой footer.' },
  { id: 'h', label: 'H · Встроенные кнопки', mode: 'rich', description: 'Действия встроены в текст сообщения.' },
]

const DESIGNS = [
  { id: 'i', label: 'I · Лента', mode: 'text', description: 'Короткая запись: сумма и кошелёк в одной строке, комментарий ниже.' },
  { id: 'j', label: 'J · Ведомость', mode: 'rich', description: 'Актив слева, изменение справа. Подробности раскрываются по нажатию.' },
  { id: 'k', label: 'K · Акцент', mode: 'rich', description: 'Цветная полоса нативной цитаты выделяет сумму; подпись и комментарий снаружи.' },
]

function renderSecondRound(designId, sample) {
  const mine = link('Основной', addressUrl(wallet))
  const tx = link('↗', explorer)
  const status = { ton: 'Получено', usdt: 'Получено', nft: 'Получен NFT', swap: 'Обмен', failed: 'Не отправлено' }[sample.id]
  const comment = sample.id === 'failed' ? 'Не хватило TON на комиссию'
    : sample.comment ? 'Оплата заказа #2048' : ''
  const amount = sample.id === 'failed' ? `25 ${tokenLink}` : sample.amount
  const details = `<p>${sample.id === 'swap' ? 'DEX' : sample.incoming ? 'От' : 'Кому'}: ${sample.peer}</p>`
    + (comment ? `<p>${escapeHtml(comment)}</p>` : '')
    + `<p>${link('Транзакция ↗', explorer)}</p>`
  if (designId === 'i') {
    const heading = sample.id === 'nft' ? `+ NFT · ${mine} ${tx}\n<b>${amount}</b>`
      : sample.id === 'swap' ? `${mine} · Обмен ${tx}\n<b>${amount}</b>`
        : `<b>${amount}</b> · ${mine} ${tx}`
    return (sample.id === 'failed' ? `⚠️ Не отправлено\n${heading}` : heading)
      + (comment ? `\n<i>${escapeHtml(comment)}</i>` : '')
  }
  if (designId === 'j') {
    const rows = sample.id === 'swap'
      ? `<tr><td>${tokenLink}</td><td align="right"><b>−25</b></td></tr><tr><td>TON</td><td align="right"><b>+8.123</b></td></tr>`
      : sample.id === 'nft'
        ? `<tr><td>${nftLink}</td><td align="right"><b>+1 NFT</b></td></tr>`
        : `<tr><td>${sample.id === 'ton' ? 'TON' : tokenLink}</td><td align="right"><b>${sample.id === 'ton' ? '+12.345' : sample.id === 'failed' ? '25 · не отправлено' : '+125.50'}</b></td></tr>`
    return `<table compact>${rows}</table><footer>${mine} · ${status} ${tx}</footer>`
      + `<details><summary>Подробности</summary>${details}</details>`
  }
  if (designId === 'k') {
    const body = sample.id === 'swap' ? `−25 ${tokenLink}<br><b>+8.123 TON</b>` : `<b>${amount}</b>`
    return `<p>${mine} · ${sample.id === 'failed' ? '⚠️ ' : ''}${status} ${tx}</p>`
      + `<blockquote><p>${body}</p></blockquote>`
      + (comment ? `<footer>${escapeHtml(comment)}</footer>` : '')
  }
}

function renderDesign(designId, caseId = 'usdt') {
  const design = [...DESIGNS, ...PREVIOUS_DESIGNS].find((item) => item.id === designId)
  const sample = CASES.find((item) => item.id === caseId)
  if (!design || !sample) throw new Error('Unknown design or example')
  if (DESIGNS.some((item) => item.id === designId)) return { mode: design.mode, html: renderSecondRound(designId, sample), design, sample }
  const { amount, title, icon, comment } = sample
  const route = sample.id === 'swap' ? `${ownLink} · STON.fi`
    : sample.incoming ? `${peerLink} → ${ownLink}` : `${ownLink} → ${peerLink}`
  const tx = link('Explorer ↗', explorer)
  const note = comment ? `\n<i>${escapeHtml(comment)}</i>` : ''
  const details = `<p>${sample.detail}: ${sample.peer}<br>Wallet: ${ownLink}</p>`
    + (comment ? `<p>${escapeHtml(comment)}</p>` : '')
    + `<p><code>${friendlyAddress(wallet)}</code></p><p>${tx}</p>`
  let html
  if (designId === 'a') {
    html = formatAction(sample.action, wallet, { tag: 'Main wallet' }, metadata)
    const lines = html.split('\n'); lines[0] += ` · ${tx}`; html = lines.join('\n')
  } else if (designId === 'b') {
    html = `${icon} <b>${amount}</b> · ${title}\n${ownLink} · ${sample.detail.toLowerCase()} ${sample.peer} · ${tx}${note}`
  } else if (designId === 'c') {
    html = `<b>${amount}</b>\n${title} · ${route} · ${tx}${note}`
  } else if (designId === 'd') {
    html = `${icon} <b>${title}</b> · ${ownLink}\n<blockquote><b>${amount}</b>\n${sample.detail}: ${sample.peer}</blockquote>${comment ? `\n${escapeHtml(comment)}` : ''}\n${tx}`
  } else if (designId === 'e') {
    html = `<p>${icon} <b>${amount}</b><br>${title} · ${ownLink}</p><details><summary>Details · ${sample.detail.toLowerCase()} ${sample.peer}</summary>${details}</details>`
  } else if (designId === 'f') {
    html = `<p>${icon} <b>${title}</b> · ${ownLink}</p><table compact><tr><td>Amount</td><td align="right"><b>${amount}</b></td></tr>`
      + `<tr><td>${sample.detail}</td><td align="right">${sample.peer}</td></tr></table>`
      + (comment ? `<footer>${escapeHtml(comment)} · ${tx}</footer>` : `<footer>${tx}</footer>`)
  } else if (designId === 'g') {
    html = `<h3>${icon} ${amount}</h3><p>${title} · ${route}</p><footer>${comment ? `${escapeHtml(comment)} · ` : ''}${tx}</footer>`
  } else if (designId === 'h') {
    html = `<p>${icon} <b>${amount}</b><br>${title} · ${ownLink}</p>`
      + `<p><tg-button type="url" style="link" url="${explorer}">Explorer ↗</tg-button> `
      + `<tg-button type="copy_text" text="${friendlyAddress(wallet)}">Copy wallet</tg-button></p>`
      + `<details><summary>${sample.detail}: ${sample.peer}</summary>${details}</details>`
  }
  return { mode: design.mode, html, design, sample }
}

module.exports = { REVISION, DESIGNS, CASES, renderDesign }
