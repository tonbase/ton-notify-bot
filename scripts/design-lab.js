const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { Bot, InlineKeyboard } = require('grammy')
const { REVISION, DESIGNS, CASES, renderDesign } = require('../src/designs')
const { readLive, stopLive, liveStatus } = require('../src/live-control')

const directory = path.join(__dirname, '..', '.local', 'design-lab')
const envFile = path.join(__dirname, '..', '.env.design')
const settings = fs.existsSync(envFile) ? require('dotenv').parse(fs.readFileSync(envFile)) : {}
const token = process.env.DESIGN_BOT_TOKEN || settings.DESIGN_BOT_TOKEN
const read = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
const write = (name, data) => {
  const target = path.join(directory, name)
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2))
  fs.renameSync(`${target}.tmp`, target)
}
const safeError = (error) => String(error?.description || error?.message || error)
  .split(token || '\0').join('[REDACTED]').replace(/bot\d+:[\w-]+/g, 'bot[REDACTED]')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function createLab(owner, state, persist, botToken = token, botInfo, pairing = {}) {
  const bot = new Bot(botToken, botInfo ? { botInfo } : undefined)
  bot.api.config.use(async (previous, method, payload, signal) => {
    for (let attempt = 0; ; attempt += 1) {
      const result = await previous(method, payload, signal)
      if (result.ok || result.error_code !== 429 || attempt >= 3) return result
      await delay((result.parameters?.retry_after || 1) * 1000 + 100)
    }
  })
  state.messages ||= {}
  state.votes ||= {}
  state.notes ||= []
  state.events ||= []
  function event(type, data) {
    state.events.push({ type, revision: REVISION, ...data, at: new Date().toISOString() })
    state.events = state.events.slice(-1000)
    persist()
  }
  const key = (design, sample) => `${REVISION}:${design}:${sample}`
  function keyboard(designId, caseId) {
    const design = DESIGNS.find((item) => item.id === designId)
    const vote = state.votes[key(designId, caseId)]?.rating
    const next = CASES[(CASES.findIndex((sample) => sample.id === caseId) + 1) % CASES.length]
    const kb = new InlineKeyboard().text(design.id.toUpperCase(), `lab:label:${designId}`)
    for (const [rating, label] of [['like', '👍'], ['dislike', '👎'], ['finalist', '⭐']]) {
      kb.text(`${vote === rating ? '✓ ' : ''}${label}`, `lab:vote:${designId}:${caseId}:${rating}`)
    }
    return kb.text(`${next.label} ›`, `lab:case:${designId}:${next.id}`)
  }
  async function sendDesign(designId, caseId = 'usdt') {
    const rendered = renderDesign(designId, caseId)
    const other = { reply_markup: keyboard(designId, caseId), disable_notification: true }
    const message = rendered.mode === 'rich'
      ? await bot.api.sendRichMessage(owner.chatId, { html: rendered.html, skip_entity_detection: true }, other)
      : await bot.api.sendMessage(owner.chatId, rendered.html, { ...other, parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
    state.messages[message.message_id] = { revision: REVISION, designId, caseId, mode: rendered.mode }
    event('sent', { messageId: message.message_id, designId, caseId, mode: rendered.mode })
    return message
  }
  async function sendGallery(force = false) {
    state.introductions ||= {}
    if (!state.introductions[REVISION]) {
      await bot.api.sendMessage(owner.chatId,
        'Новая тройка: I — короткая запись, J — таблица сумм, K — акцент цитатой.\n\n👍 нравится · 👎 мимо · ⭐ в финал. Последняя кнопка меняет пример; буква показывает описание. Замечание — ответом на вариант. Кнопки оценки только для лаборатории.\n\nДанные вымышленные, ↗ открывает главную обозревателя. /results — оценки.')
      state.introductions[REVISION] = true; persist()
    }
    for (const design of DESIGNS) {
      if (!force && Object.values(state.messages).some((m) => m.revision === REVISION && m.designId === design.id)) continue
      try { await sendDesign(design.id) }
      catch (error) { event('send_error', { designId: design.id, error: safeError(error) }); console.error(`${design.id}: ${safeError(error)}`) }
      await delay(1200)
    }
  }
  async function editDesign(messageId, designId, caseId) {
    const rendered = renderDesign(designId, caseId)
    const body = rendered.mode === 'rich' ? { html: rendered.html, skip_entity_detection: true } : rendered.html
    await bot.api.editMessageText(owner.chatId, messageId, body, {
      reply_markup: keyboard(designId, caseId), ...(rendered.mode === 'text'
        ? { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } : {}),
    })
    state.messages[messageId] = { revision: REVISION, designId, caseId, mode: rendered.mode }
    persist()
  }
  bot.use(async (ctx, next) => {
    if (!owner.userId) {
      if (pairing.code && ctx.chat?.type === 'private' && ctx.from?.id === ctx.chat.id
        && ctx.message?.text === `/start ${pairing.code}`) {
        Object.assign(owner, { userId: ctx.from.id, chatId: ctx.chat.id,
          botId: ctx.me.id, botUsername: ctx.me.username, registeredAt: new Date().toISOString() })
        pairing.save(owner)
        event('registered', {})
        await sendGallery()
      }
      return
    }
    if (ctx.from?.id !== owner.userId || ctx.chat?.id !== owner.chatId || ctx.chat.type !== 'private') return
    return next()
  })
  bot.command(['start', 'designs'], () => sendGallery())
  bot.command('again', () => sendGallery(true))
  bot.command('live_stop', async (ctx) => { stopLive(); await ctx.reply('Останавливаю реальные уведомления.') })
  bot.command('live_status', (ctx) => ctx.reply(liveStatus()))
  bot.callbackQuery('live:stop', async (ctx) => {
    stopLive()
    await ctx.answerCallbackQuery({ text: 'Поток остановлен' })
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } })
  })
  bot.command('results', (ctx) => {
    const votes = Object.entries(state.votes).filter(([id]) => id.startsWith(`${REVISION}:`))
    const rows = votes.map(([id, vote]) => {
      const [, design, sample] = id.split(':')
      return `${DESIGNS.find((d) => d.id === design).label} / ${CASES.find((s) => s.id === sample).label}: ${vote.rating === 'finalist' ? '⭐ в финал' : vote.rating === 'like' ? '👍 норм' : '👎 мимо'}`
    })
    return ctx.reply(rows.length ? rows.join('\n') : 'Оценок пока нет. Нажми кнопки под вариантами.')
  })
  bot.on('callback_query:data', async (ctx) => {
    const parts = ctx.callbackQuery.data.split(':')
    if (parts[0] !== 'lab') return
    const [, operation, designId, caseId, rating] = parts
    const messageId = ctx.callbackQuery.message?.message_id
    if (state.messages[messageId]?.revision !== REVISION) return ctx.answerCallbackQuery({ text: 'Этот раунд завершён. Используй /designs.' })
    const design = DESIGNS.find((item) => item.id === designId)
    if (!design) return ctx.answerCallbackQuery({ text: 'Неизвестный вариант' })
    if (state.messages[messageId]?.designId !== designId) return ctx.answerCallbackQuery({ text: 'Кнопка относится к другому варианту' })
    if (operation === 'label') return ctx.answerCallbackQuery({ text: design.description, show_alert: true })
    if (!CASES.some((item) => item.id === caseId)) return ctx.answerCallbackQuery({ text: 'Неизвестный пример' })
    if (operation === 'vote' && state.messages[messageId]?.caseId !== caseId) return ctx.answerCallbackQuery({ text: 'Пример уже изменился. Нажми оценку ещё раз.' })
    if (operation === 'vote' && ['like', 'dislike', 'finalist'].includes(rating)) {
      state.votes[key(designId, caseId)] = { rating, at: new Date().toISOString() }
      event('vote', { designId, caseId, rating })
      await ctx.answerCallbackQuery({ text: rating === 'finalist' ? 'Добавлено в финал ⭐' : 'Оценка сохранена' })
      return ctx.editMessageReplyMarkup({ reply_markup: keyboard(designId, caseId) })
    }
    if (operation === 'case') {
      await ctx.answerCallbackQuery()
      if (state.messages[messageId]?.caseId !== caseId) await editDesign(messageId, designId, caseId)
      return
    }
    if (operation === 'note') {
      state.pendingNote = { revision: REVISION, designId, caseId }; persist()
      await ctx.answerCallbackQuery()
      const prompt = await ctx.reply(`Что изменить в ${design.label} / ${CASES.find((item) => item.id === caseId).label}? Напиши одним сообщением.`,
        { reply_markup: { force_reply: true, selective: true } })
      state.notePrompts ||= {}; state.notePrompts[prompt.message_id] = { revision: REVISION, designId, caseId }; persist()
    }
  })
  bot.on('message:text', async (ctx) => {
    const replyId = ctx.message.reply_to_message?.message_id
    const preview = readLive('previews.json')?.[replyId]
    if (preview) {
      state.notes.push({ source: 'live', revision: preview.revision, messageId: replyId, text: ctx.message.text, at: new Date().toISOString() })
      event('note', { source: 'live', revision: preview.revision })
      await ctx.reply('Сохранил замечание к уведомлению.')
      return
    }
    const liveSession = readLive('control.json')?.session
    if (liveSession && /^[a-f0-9]{8}$/.test(liveSession) && readLive(`session-${liveSession}.json`)?.messages?.[replyId]) {
      state.notes.push({ source: 'live', liveSession, messageId: replyId, text: ctx.message.text, at: new Date().toISOString() })
      event('note', { source: 'live' })
      await ctx.reply('Сохранил замечание к реальному уведомлению.')
      return
    }
    const target = state.notePrompts?.[replyId] || state.messages[replyId] || state.pendingNote || null
    state.notes.push({ revision: target?.revision || REVISION, ...(target ? { designId: target.designId, caseId: target.caseId } : {}),
      text: ctx.message.text, at: new Date().toISOString() })
    state.pendingNote = null
    event('note', { ...(target ? { designId: target.designId, caseId: target.caseId } : {}) })
    await ctx.reply('Сохранил комментарий.' + (target ? ` Вариант ${target.designId.toUpperCase()}.` : ' Общий отзыв.'))
  })
  bot.catch(({ error }) => {
    if (error.description?.includes('message is not modified')) return
    console.error(safeError(error)); event('update_error', { error: safeError(error) })
  })
  return { bot, sendGallery, sendDesign, editDesign }
}

async function main() {
  if (!token) throw new Error('Set DESIGN_BOT_TOKEN in ignored .env.design')
  fs.mkdirSync(directory, { recursive: true })
  if (process.argv[2] === '--register') {
    const registration = new Bot(token)
    await registration.init()
    const webhook = await registration.api.getWebhookInfo()
    if (webhook.url) throw new Error('A webhook is configured; registration did not change it')
    const updates = await registration.api.getUpdates({ timeout: 0, limit: 100, allowed_updates: ['message', 'callback_query'] })
    const starts = updates.filter((update) => update.message?.chat.type === 'private'
      && /^\/start(?:@\w+)?(?:\s|$)/.test(update.message.text || '')
      && Date.now() / 1000 - update.message.date < 86400)
    const users = [...new Set(starts.map((update) => update.message.from.id))]
    if (users.length !== 1) throw new Error(`Expected one recent private /start sender, found ${users.length}. Send /start again.`)
    const message = starts[0].message
    write('owner.json', { userId: message.from.id, chatId: message.chat.id,
      botId: registration.botInfo.id, botUsername: registration.botInfo.username, registeredAt: new Date().toISOString() })
    console.log('Private owner registered; identity saved only under .local/design-lab')
    return
  }
  const owner = read('owner.json', {})
  if (owner.userId && (!Number.isSafeInteger(owner.userId) || owner.userId !== owner.chatId)) throw new Error('Invalid private owner registration')
  const pairing = read('pairing.json', { code: `design_${randomBytes(16).toString('hex')}` })
  if (!owner.userId) write('pairing.json', pairing)
  const state = read('state.json', {})
  const persist = () => write('state.json', state)
  const { bot, sendGallery, sendDesign } = createLab(owner, state, persist, token, undefined, {
    code: pairing.code, save: (value) => {
      write('owner.json', value)
      write('status.json', { status: 'polling', pid: process.pid, registeredAt: new Date().toISOString() })
    },
  })
  await bot.init()
  if (owner.botId && bot.botInfo.id !== owner.botId) throw new Error('Saved owner belongs to another bot token')
  if (process.argv[2] === '--send-one') {
    if (!owner.userId) throw new Error('Owner must be registered before sending a design')
    await sendDesign(process.argv[3], process.argv[4]); return
  }
  const lock = path.join(directory, 'runner.pid')
  if (fs.existsSync(lock)) {
    const previous = Number(fs.readFileSync(lock, 'utf8'))
    let running = false
    try { process.kill(previous, 0); running = true } catch { /* prior process stopped */ }
    if (running) throw new Error('Design bot is already running')
  }
  fs.writeFileSync(lock, String(process.pid))
  const stop = () => { if (bot.isRunning()) void bot.stop().catch(() => {}) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  process.once('exit', () => { if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.unlinkSync(lock) })
  console.log('Design bot starting; owner restriction enabled; votes saved privately')
  if (!owner.userId) console.log(`Pairing link: https://t.me/${bot.botInfo.username}?start=${pairing.code}`)
  await bot.start({ allowed_updates: ['message', 'callback_query'], onStart: async () => {
    write('status.json', { status: owner.userId ? 'polling' : 'awaiting_start', pid: process.pid, startedAt: new Date().toISOString() })
    if (owner.userId && read('approved.json', {}).status !== 'approved') await sendGallery()
  } })
}

if (require.main === module) main().catch((error) => { console.error(safeError(error)); process.exit(1) })
module.exports = { createLab }
