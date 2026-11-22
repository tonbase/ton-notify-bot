const { RequestLimiter } = require('./request-limiter')
const { setCooldown, saveCooldown } = require('./delivery-state')

class DeliveryDeferred extends Error {
  constructor(untilMs) {
    super('Telegram delivery is waiting for the shared cooldown')
    this.name = 'DeliveryDeferred'
    this.untilMs = untilMs
  }
}

function telegramError(error) {
  const body = error?.error || error || {}
  const seconds = Number(body.parameters?.retry_after)
  return {
    code: Number(body.error_code) || 0,
    description: String(body.description || ''),
    retryAfterMs: Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 + 100 : 0,
  }
}

function assertDeliveryReady(state) {
  if (state.cooldownUntil > Date.now()) throw new DeliveryDeferred(state.cooldownUntil)
}

function createTelegramSender(api, state, { requestsPerSecond = 10, concurrency = 8, limiter } = {}) {
  limiter ||= new RequestLimiter(requestsPerSecond, concurrency)
  const send = (method, args, beforeSend) => limiter.run(async () => {
    // Check inside the limiter: another in-flight request may have received 429
    // after this call joined the pacing queue.
    await saveCooldown(state)
    assertDeliveryReady(state)
    beforeSend?.()
    try { return await api[method](...args) }
    catch (error) {
      const failure = telegramError(error)
      if (failure.code === 429) {
        setCooldown(state, Date.now() + (failure.retryAfterMs || 60000))
        try { await saveCooldown(state) }
        catch (cause) {
          // Keep Telegram's retry_after available to the queue even when the
          // cooldown write fails. The dirty state is retried before any send.
          throw Object.assign(new Error('Could not persist Telegram cooldown', { cause }), { error: error.error || error })
        }
      }
      throw error
    }
  })
  const guarded = (beforeSend) => ({
    sendMessage: (...args) => send('sendMessage', args, beforeSend),
    ...(typeof api.sendRichMessage === 'function'
      ? { sendRichMessage: (...args) => send('sendRichMessage', args, beforeSend) } : {}),
  })
  return { ...guarded(), withGuard: guarded }
}

function renderBatch(batch, channelId) {
  let text = batch.map((item) => item.text).join('\n\n')
  let richHtml = batch.every((item) => item.rich_html)
    ? batch.map((item) => item.rich_html).join('\n') : null
  if (batch.some((item) => item.chat_type === 'channel')
    || (channelId && String(batch[0].chat_id) === String(channelId))) {
    const standardEmoji = (html) => html?.replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gu, '$1')
    const channelStyle = (html) => standardEmoji(html)?.replace(/💎\s*/gu, '')
      .replace(/<b>([^<]*\bGRAM\b[^<]*)<\/b>/gu, (_match, amount) => `<b>${amount
        .replace(/([−+-]?\d[\d,]*)\.\d+(?=\s+GRAM\b)/gu, '$1')
        .replace(/[−-](?=\d[\d,]*\s+GRAM\b)/gu, '')
        .replace(/(\$\d[\d,]*)\.\d+/gu, '$1')}</b>`)
      .replace(/<b>(?:💵\s*)?([−+-]?)(\d[\d,]*(?:\.\d+)?)\s+(<a\b[^>]*>USD[tT]<\/a>|USD[tT])<\/b>/gu,
        (_match, sign, amount, asset) => `<b>${sign === '+' ? '+' : ''}${amount} ${asset}</b>`)
    text = channelStyle(text)
    richHtml = channelStyle(richHtml)
  }
  return { text, richHtml }
}

async function sendBatch(api, batch, state, channelId, beforeSend) {
  beforeSend?.()
  if (beforeSend && api.withGuard) api = api.withGuard(beforeSend)
  const { text, richHtml } = renderBatch(batch, channelId)
  const chatId = batch[0].chat_id
  assertDeliveryReady(state)
  if (richHtml && typeof api.sendRichMessage === 'function') {
    try { return await api.sendRichMessage(chatId, { html: richHtml, skip_entity_detection: true }) }
    catch (error) {
      // Only an explicit rejection permits a second send. A timeout can mean
      // that Telegram accepted the first message and its response was lost.
      if (telegramError(error).code !== 400) throw error
    }
  }
  assertDeliveryReady(state)
  beforeSend?.()
  return api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    ...(batch[0].reply_markup ? { reply_markup: batch[0].reply_markup } : {}) })
}

module.exports = { createTelegramSender, telegramError, DeliveryDeferred, renderBatch, sendBatch }
