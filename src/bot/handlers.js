const { InlineKeyboard } = require('grammy')
const { rawAddress, friendlyAddress, shortAddress } = require('../address')
const { resolveDnsAddress } = require('../dns')
const { toNano } = require('../amount')
const { escapeHtml } = require('../events')
const { safeError } = require('../runtime')
const { parseAddressInput, parseWordFilters } = require('./input')
const { getOwned, listAddresses, addressPage, updateFields, changeSettings, subscribe } = require('./subscriptions')
const { reply, menuLabel, listKeyboard, addressKeyboard, notificationsKeyboard, notificationsText } = require('./views')
const { showDigest } = require('./digests')

async function showList(ctx, page = 0, edit = false) {
  ctx.session.flow = null
  const result = await listAddresses(ctx.from.id, page)
  if (!result.addresses.length) return reply(ctx, '😔 You have no addresses added. Send a wallet address, .ton or .grm name, optionally with <code>:tag</code>.', null, edit)
  return reply(ctx, 'Choose an address from the list below:', listKeyboard(result.addresses, result.page, result.pages), edit)
}

async function showAddress(ctx, record, edit = false) {
  ctx.session.flow = null
  const page = await addressPage(record)
  const label = record.tag ? `${escapeHtml(menuLabel(record.tag))} ` : ''
  return reply(ctx, `Here it is: ${label}<a href="https://tonscan.org/address/${encodeURIComponent(friendlyAddress(record.address))}">${shortAddress(record.address)}</a>.\n\nWhat do you want to do with the address?`, addressKeyboard(record, page), edit)
}

async function addAddress(ctx, input, resolveDomain = resolveDnsAddress) {
  const parsed = parseAddressInput(input)
  if (!parsed) return reply(ctx, 'Invalid address. Send a wallet address, a .ton or .grm name, optionally followed by <code>:tag</code>.')
  const domain = !rawAddress(parsed.address) ? parsed.address : null
  let dnsKind = null
  if (domain) {
    let resolved
    try { resolved = await resolveDomain(parsed.address) } catch (error) {
      console.error(`DNS lookup failed for ${parsed.address}: ${safeError(error)}`)
      return reply(ctx, 'DNS lookup is temporarily unavailable. Please try again later.')
    }
    if (!resolved || !rawAddress(resolved.address)) return reply(ctx, `No wallet or domain owner found for ${escapeHtml(parsed.address)}.`)
    parsed.address = friendlyAddress(resolved.address)
    dnsKind = resolved.kind
  }
  // An explicit tag on a DNS name labels an existing subscription too.
  const { record, added } = await subscribe(ctx.from.id, parsed, {
    replaceExistingTag: Boolean(domain && String(input).trim().includes(':')),
  })
  if (!added) return showAddress(ctx, record)
  ctx.session.flow = null
  const text = `${domain ? `${escapeHtml(domain)} → ` : ''}<a href="https://tonscan.org/address/${encodeURIComponent(friendlyAddress(record.address))}">${shortAddress(record.address)}</a>${record.tag ? ` · ${escapeHtml(menuLabel(record.tag))}` : ''} was added.\n\n${dnsKind === 'owner' ? 'Notifications will track the current domain owner. Add the name again if ownership changes.' : "You'll get notified about activity of this address."}`
  return reply(ctx, text, new InlineKeyboard().text('Open Address', `open_${record.id}`).text('Edit Tag', `edit_${record.id}`))
}

async function handleFlow(ctx, text) {
  const { flow, addressId } = ctx.session
  const record = await getOwned(ctx.from.id, addressId)
  if (!record) { ctx.session.flow = null; return reply(ctx, 'Address unavailable. Use /list to choose another.') }
  if (flow === 'tag') {
    await updateFields(record, { tag: text })
    return showAddress(ctx, record)
  }
  if (flow === 'amount') {
    const nano = toNano(text.trim())
    if (nano === null || BigInt(nano) > 5000000000000000000n) return reply(ctx, 'Invalid amount. Send a GRAM value from 0 to 5,000,000,000 with at most 9 significant decimal places.')
    await changeSettings(record, { min_amount: nano })
    ctx.session.flow = null
    return reply(ctx, notificationsText(record), notificationsKeyboard(record))
  }
  if (flow === 'filters') {
    const filters = parseWordFilters(text)
    await changeSettings(record, filters)
    ctx.session.flow = null
    return reply(ctx, notificationsText(record), notificationsKeyboard(record))
  }
  ctx.session.flow = null
  return null
}

function registerInlineQueries(bot, { resolveDomain = resolveDnsAddress } = {}) {
  bot.on('inline_query', async (ctx) => {
    const parsed = parseAddressInput(ctx.inlineQuery.query)
    let address = parsed?.address
    if (address && !rawAddress(address)) {
      try { address = (await resolveDomain(address))?.address } catch (error) {
        console.error(`DNS lookup failed for ${address}: ${safeError(error)}`)
        address = null
      }
    }
    const results = address && rawAddress(address) ? [{ type: 'article', id: 'address', title: 'Share address',
      description: parsed.address, input_message_content: { message_text: address },
      reply_markup: new InlineKeyboard().url('Track address', `https://t.me/${ctx.me.username}?start=${friendlyAddress(address)}`),
    }] : []
    return ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true })
  })
}

function registerHandlers(bot, { resolveDomain = resolveDnsAddress } = {}) {
  bot.command('start', async (ctx) => {
    const payload = ctx.message?.text?.replace(/^\/start(?:@\w+)?\s*/, '').trim()
    if (payload) return addAddress(ctx, payload, resolveDomain)
    ctx.session.flow = null
    return reply(ctx, 'I send notifications about blockchain activity of your addresses.\n\nSend a wallet address or a .ton/.grm name, optionally with <code>:tag</code>. DNS names use their wallet record, or the owner when no wallet is set.\n\n/list — manage your alerts\n\nPowered by @tonbase.')
  })
  bot.command('list', (ctx) => showList(ctx))
  bot.on('message:text', async (ctx) => {
    if (parseAddressInput(ctx.message.text)) return addAddress(ctx, ctx.message.text, resolveDomain)
    if (ctx.session.flow) return handleFlow(ctx, ctx.message.text)
    if (ctx.message.text.startsWith('/')) return null
    return addAddress(ctx, ctx.message.text, resolveDomain)
  })

  bot.on('callback_query:data', async (ctx) => {
    let data = ctx.callbackQuery.data
    await ctx.answerCallbackQuery().catch(() => {})
    if (data === 'noop') return null
    const digest = data.match(/^dg:([a-f0-9]{24}):(\d{1,10}):(s|\d{1,6})$/iu)
    if (digest) return showDigest(ctx, ...digest.slice(1))
    if (/^list_\d+$/.test(data)) return showList(ctx, Number(data.slice(5)), true)
    if (/^open-list-[a-f0-9]{24}-\d+$/i.test(data)) return showList(ctx, Number(data.split('-').at(-1)), true)
    // Old scene buttons omitted the address ID; resolve it only from the
    // owner's active persisted flow, then apply the usual ownership check.
    if ((data === 'reset_min_amount' && ctx.session.flow === 'amount')
      || (data === 'clear_exceptions' && ctx.session.flow === 'filters')) data += `_${ctx.session.addressId}`
    const match = data.match(/^(open|edit|notify|delete|undo|notify_dust|notify_min_amout|notify_exceptions|clear_exceptions|reset_min_amount)_([a-f0-9]{24})(?:_(on|off))?$/i)
    if (!match) return reply(ctx, 'This button has expired. Use /list.')
    const [, kind, id, state] = match
    const record = await getOwned(ctx.from.id, id, kind === 'undo')
    if (!record) return reply(ctx, 'Address unavailable. Use /list to choose another.')
    if (kind === 'open') return showAddress(ctx, record, true)
    if (kind === 'edit') {
      ctx.session = { flow: 'tag', addressId: id }
      return reply(ctx, `Send me a tag for ${shortAddress(record.address)}:`, new InlineKeyboard().text('« Back to Address', `open_${id}`), true)
    }
    if (kind === 'notify' && state) {
      await changeSettings(record, { is_enabled: state === 'on' })
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'notify_dust' && state) {
      await changeSettings(record, { filter_dust: state === 'on' })
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'notify') {
      ctx.session.flow = null
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'notify_min_amout') {
      ctx.session = { flow: 'amount', addressId: id }
      return reply(ctx, `Send a minimum GRAM amount for ${shortAddress(record.address)}. For example: <code>0.1</code>.`, new InlineKeyboard().text('Reset', `reset_min_amount_${id}`).row().text('« Back to notifications', `notify_${id}`), true)
    }
    if (kind === 'notify_exceptions') {
      ctx.session = { flow: 'filters', addressId: id }
      return reply(ctx, 'Send comma-separated comments to match exactly. Prefix with <code>-</code> to exclude, <code>+</code> to include. Example: <code>+cashback, -ads</code>.', new InlineKeyboard().text('Clear', `clear_exceptions_${id}`).row().text('« Back to notifications', `notify_${id}`), true)
    }
    if (kind === 'reset_min_amount') {
      await changeSettings(record, { min_amount: '0' })
      ctx.session.flow = null
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'clear_exceptions') {
      await changeSettings(record, { exceptions: [], inclusion: [] })
      ctx.session.flow = null
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'delete') {
      await updateFields(record, { is_deleted: true })
      ctx.session.flow = null
      return reply(ctx, `${shortAddress(record.address)} was deleted.`, new InlineKeyboard().text('Undo', `undo_${id}`).row().text('Open Address list', 'list_0'), true)
    }
    if (kind === 'undo') {
      await updateFields(record, { is_deleted: false })
      return showAddress(ctx, record, true)
    }
    return null
  })

  return bot
}

module.exports = { registerInlineQueries, registerHandlers }
