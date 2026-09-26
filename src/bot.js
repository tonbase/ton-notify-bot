const { Bot, InlineKeyboard } = require('grammy')
const { config, requireBotToken } = require('./config')
const { mongoose, Address, User, Session } = require('./models')
const { rawAddress, friendlyAddress, shortAddress } = require('./address')
const { toNano, formatUnits } = require('./amount')
const { escapeHtml } = require('./events')

const PAGE_SIZE = 5
const html = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }

function parseAddressInput(input) {
  const match = String(input || '').trim().match(/^(-?\d:[a-fA-F0-9]{64}|[a-zA-Z0-9_-]{48})(?::([^\r\n]{1,80}))?$/)
  if (!match || !rawAddress(match[1])) return null
  return { address: match[1], tag: (match[2] || '').trim() }
}

async function reply(ctx, message, keyboard, edit = false) {
  const options = { ...html, ...(keyboard ? { reply_markup: keyboard } : {}) }
  if (edit && ctx.callbackQuery?.message) {
    try { return await ctx.editMessageText(message, options) } catch (error) {
      if (error.description?.includes('message is not modified')) return null
      throw error
    }
  }
  return ctx.reply(message, options)
}

function normalizeSettings(record) {
  return record.notifications || { is_enabled: true, min_amount: '0', exceptions: [], inclusion: [] }
}

function listKeyboard(addresses, page, pages) {
  const keyboard = new InlineKeyboard()
  for (const record of addresses) {
    keyboard.text(`${record.tag ? `${record.tag}: ` : ''}${shortAddress(record.address)}`.slice(0, 55), `open_${record.id}`).row()
  }
  if (pages > 1) {
    if (page > 0) keyboard.text('« Prev', `list_${page - 1}`)
    keyboard.text(`${page + 1}/${pages}`, 'noop')
    if (page + 1 < pages) keyboard.text('Next »', `list_${page + 1}`)
  }
  return keyboard
}

async function showList(ctx, page = 0, edit = false) {
  ctx.session.flow = null
  const filter = { user_id: ctx.from.id, is_deleted: false }
  const count = await Address.countDocuments(filter)
  if (!count) return reply(ctx, '😔 You have no addresses added. Send me a TON address or <code>address:tag</code>.', null, edit)
  const pages = Math.ceil(count / PAGE_SIZE)
  const safePage = Math.min(Math.max(Number(page) || 0, 0), pages - 1)
  const addresses = await Address.find(filter).sort({ _id: 1 }).skip(safePage * PAGE_SIZE).limit(PAGE_SIZE)
  return reply(ctx, 'Choose an address from the list below:', listKeyboard(addresses, safePage, pages), edit)
}

function addressKeyboard(record, page = 0) {
  const keyboard = new InlineKeyboard()
  keyboard.text(`Notifications: ${normalizeSettings(record).is_enabled ? 'ON' : 'OFF'}`, `notify_${record.id}`)
    .text('Edit Tag', `edit_${record.id}`).row()
    .switchInline('Share Address', `${record.address}`).text('Delete Address', `delete_${record.id}`).row()
    .text('« Back to Address list', `list_${page}`)
  return keyboard
}

function notificationsKeyboard(record) {
  const n = normalizeSettings(record)
  const min = String(n.min_amount || '0')
  return new InlineKeyboard()
    .text(`Send notifications: ${n.is_enabled ? 'Yes' : 'No'}`, `notify_${record.id}_${n.is_enabled ? 'off' : 'on'}`).row()
    .text(`Min. amount: ${min === '0' ? 'OFF' : `${formatUnits(min)} TON`}`, `notify_min_amout_${record.id}`).row()
    .text((n.exceptions?.length || n.inclusion?.length) ? 'Edit exceptions' : 'Add exceptions', `notify_exceptions_${record.id}`).row()
    .text('« Back to Address', `open_${record.id}`)
}

function notificationsText(record) {
  const n = normalizeSettings(record)
  const exclusions = n.exceptions?.length ? escapeHtml(n.exceptions.join(', ')) : '<b>disabled</b>'
  const inclusions = n.inclusion?.length ? escapeHtml(n.inclusion.join(', ')) : '<b>disabled</b>'
  return `Here you can set notifications.\n\nExceptions: ${exclusions}\nInclusion: ${inclusions}`
}

async function getOwned(ctx, id, allowDeleted = false) {
  if (!/^[a-f0-9]{24}$/i.test(id || '')) return null
  const record = await Address.findOne({ _id: id, user_id: ctx.from.id })
  return record && (allowDeleted || !record.is_deleted) ? record : null
}

async function showAddress(ctx, record, edit = false) {
  ctx.session.flow = null
  const preceding = await Address.countDocuments({ user_id: ctx.from.id, is_deleted: false, _id: { $lt: record._id } })
  const page = Math.floor(preceding / PAGE_SIZE)
  const label = record.tag ? `${escapeHtml(record.tag)} ` : ''
  return reply(ctx, `Here it is: ${label}<a href="https://tonscan.org/address/${encodeURIComponent(friendlyAddress(record.address))}">${shortAddress(record.address)}</a>.\n\nWhat do you want to do with the address?`, addressKeyboard(record, page), edit)
}

async function addAddress(ctx, input) {
  const parsed = parseAddressInput(input)
  if (!parsed) return reply(ctx, 'Invalid TON address. Send a valid address, optionally followed by <code>:tag</code>.')
  const existing = await Address.find({ user_id: ctx.from.id })
  let record = existing.find((entry) => rawAddress(entry.address) === rawAddress(parsed.address))
  if (!record) {
    try { record = await Address.create({ user_id: ctx.from.id, address: parsed.address, tag: parsed.tag }) }
    catch (error) {
      if (error.code !== 11000) throw error
      record = await Address.findOne({ user_id: ctx.from.id, address: parsed.address })
    }
  } else if (record.is_deleted) {
    record.is_deleted = false
    record.tag = parsed.tag || record.tag
    await record.save()
  }
  ctx.session.flow = null
  if (!record) throw new Error('Could not create address')
  const text = `<a href="https://tonscan.org/address/${encodeURIComponent(friendlyAddress(record.address))}">${shortAddress(record.address)}</a>${record.tag ? ` · ${escapeHtml(record.tag)}` : ''} was added.\n\nYou'll get notified about activity of this address.`
  return reply(ctx, text, new InlineKeyboard().text('Open Address', `open_${record.id}`).text('Edit Tag', `edit_${record.id}`))
}

function parseWordFilters(text) {
  const exceptions = new Set()
  const inclusion = new Set()
  for (const raw of text.split(',')) {
    const trimmed = raw.trim()
    const word = trimmed.replace(/^[+-]/, '').trim()
    if (!word) continue
    if (trimmed.startsWith('-')) exceptions.add(word)
    else inclusion.add(word)
  }
  return { exceptions: [...exceptions], inclusion: [...inclusion] }
}

async function handleFlow(ctx, text) {
  const { flow, addressId } = ctx.session
  const record = await getOwned(ctx, addressId)
  if (!record) { ctx.session.flow = null; return reply(ctx, 'Address unavailable. Use /list to choose another.') }
  if (flow === 'tag') {
    record.tag = text.trim().slice(0, 80)
    await record.save()
    return showAddress(ctx, record)
  }
  if (flow === 'amount') {
    const nano = toNano(text.trim())
    if (nano === null) return reply(ctx, 'Invalid amount. Send a non-negative TON value with at most 9 decimal places.')
    record.notifications.min_amount = nano
    await record.save()
    ctx.session.flow = null
    return reply(ctx, notificationsText(record), notificationsKeyboard(record))
  }
  if (flow === 'filters') {
    const filters = parseWordFilters(text)
    record.notifications.exceptions = filters.exceptions
    record.notifications.inclusion = filters.inclusion
    await record.save()
    ctx.session.flow = null
    return reply(ctx, notificationsText(record), notificationsKeyboard(record))
  }
  ctx.session.flow = null
  return null
}

function createBot(token = config.botToken, botInfo) {
  if (!token) throw new Error('BOT_TOKEN is missing')
  const bot = new Bot(token, botInfo ? { botInfo } : undefined)

  bot.use(async (ctx, next) => {
    if (ctx.myChatMember?.chat?.type === 'private') {
      const blocked = ctx.myChatMember.new_chat_member?.status === 'kicked'
      await User.updateOne({ user_id: ctx.myChatMember.chat.id }, { $set: { is_blocked: blocked } })
    }
    if (!ctx.from || ctx.chat?.type !== 'private') return null
    ctx.user = await User.findOneAndUpdate({ user_id: ctx.from.id }, {
      $set: {
        first_name: ctx.from.first_name || 'User', last_name: ctx.from.last_name || '',
        language_code: ctx.from.language_code || '', last_activity_at: new Date(),
        is_deactivated: false,
      },
      $setOnInsert: { user_id: ctx.from.id },
    }, { upsert: true, new: true })
    const key = { user_id: ctx.from.id, chat_id: ctx.chat.id }
    const saved = await Session.findOne(key)
    ctx.session = saved?.data || {}
    await next()
    await Session.updateOne(key, { $set: { data: ctx.session } }, { upsert: true })
  })

  bot.command('start', async (ctx) => {
    const payload = ctx.message?.text?.replace(/^\/start(?:@\w+)?\s*/, '').trim()
    if (payload) return addAddress(ctx, payload)
    ctx.session.flow = null
    return reply(ctx, 'I send notifications about activity of TON addresses.\n\nSend me an address like <code>address:tag</code> to track it.\n\n/list — manage your alerts\n\nPowered by @tonbase.')
  })
  bot.command('list', (ctx) => showList(ctx))
  bot.on('message:text', async (ctx) => {
    if (ctx.session.flow) return handleFlow(ctx, ctx.message.text)
    if (ctx.message.text.startsWith('/')) return null
    return addAddress(ctx, ctx.message.text)
  })

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data
    await ctx.answerCallbackQuery().catch(() => {})
    if (data === 'noop') return null
    if (/^list_\d+$/.test(data)) return showList(ctx, Number(data.slice(5)), true)
    if (/^open-list-[a-f0-9]{24}-\d+$/i.test(data)) return showList(ctx, Number(data.split('-').at(-1)), true)
    const match = data.match(/^(open|edit|notify|delete|undo|notify_min_amout|notify_exceptions|clear_exceptions|reset_min_amount)_([a-f0-9]{24})(?:_(on|off))?$/i)
    if (!match) return reply(ctx, 'This button has expired. Use /list.')
    const [, kind, id, state] = match
    const record = await getOwned(ctx, id, kind === 'undo')
    if (!record) return reply(ctx, 'Address unavailable. Use /list to choose another.')
    if (kind === 'open') return showAddress(ctx, record, true)
    if (kind === 'edit') {
      ctx.session = { flow: 'tag', addressId: id }
      return reply(ctx, `Send me a tag for ${shortAddress(record.address)}:`, new InlineKeyboard().text('« Back to Address', `open_${id}`), true)
    }
    if (kind === 'notify' && state) {
      record.notifications.is_enabled = state === 'on'
      await record.save()
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'notify') {
      ctx.session.flow = null
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'notify_min_amout') {
      ctx.session = { flow: 'amount', addressId: id }
      return reply(ctx, `Send a minimum TON amount for ${shortAddress(record.address)}. For example: <code>0.1</code>.`, new InlineKeyboard().text('Reset', `reset_min_amount_${id}`).row().text('« Back to notifications', `notify_${id}`), true)
    }
    if (kind === 'notify_exceptions') {
      ctx.session = { flow: 'filters', addressId: id }
      return reply(ctx, 'Send comma-separated words. Prefix with <code>-</code> to exclude, <code>+</code> to include. Example: <code>+cashback, -ads</code>.', new InlineKeyboard().text('Clear', `clear_exceptions_${id}`).row().text('« Back to notifications', `notify_${id}`), true)
    }
    if (kind === 'reset_min_amount') {
      record.notifications.min_amount = '0'
      await record.save()
      ctx.session.flow = null
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'clear_exceptions') {
      record.notifications.exceptions = []
      record.notifications.inclusion = []
      await record.save()
      ctx.session.flow = null
      return reply(ctx, notificationsText(record), notificationsKeyboard(record), true)
    }
    if (kind === 'delete') {
      record.is_deleted = true
      await record.save()
      ctx.session.flow = null
      return reply(ctx, `${shortAddress(record.address)} was deleted.`, new InlineKeyboard().text('Undo', `undo_${id}`).row().text('Open Address list', 'list_0'), true)
    }
    if (kind === 'undo') {
      record.is_deleted = false
      await record.save()
      return showAddress(ctx, record, true)
    }
    return null
  })
  bot.catch((error) => console.error('Bot update error:', error.error))
  return bot
}

async function main() {
  requireBotToken()
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000, autoIndex: false })
  const bot = createBot()
  console.log('Bot connected to MongoDB; starting grammY polling')
  process.once('SIGINT', () => bot.stop())
  process.once('SIGTERM', () => bot.stop())
  await bot.start()
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })

module.exports = { createBot, parseAddressInput, parseWordFilters }
