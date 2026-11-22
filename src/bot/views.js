const { InlineKeyboard } = require('grammy')
const { config } = require('../config')
const { shortAddress } = require('../address')
const { formatUnits } = require('../amount')
const { escapeHtml } = require('../events')
const { normalizeSettings } = require('./subscriptions')

const html = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }

async function reply(ctx, message, keyboard, edit = false) {
  const options = { ...html, ...(keyboard ? { reply_markup: keyboard } : {}) }
  if (edit && ctx.callbackQuery?.message) {
    try { return await ctx.editMessageText(message, options) } catch (error) {
      if (error.description?.includes('message is not modified')) return null
      if (error.error_code === 400 && /message to edit not found|message can't be edited|message_id_invalid/iu.test(error.description || '')) {
        return ctx.reply(message, options)
      }
      throw error
    }
  }
  return ctx.reply(message, options)
}

const menuLabel = (value, limit = 500) => Array.from(String(value || '')).slice(0, limit).join('')

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
    .text(`Min. amount: ${min === '0' ? 'OFF' : `${formatUnits(min)} GRAM`}`, `notify_min_amout_${record.id}`).row()
    .text(`Hide small incoming: ${n.filter_dust !== false && config.minIncomingGramNano !== '0' ? 'ON' : 'OFF'}`, `notify_dust_${record.id}_${n.filter_dust !== false ? 'off' : 'on'}`).row()
    .text((n.exceptions?.length || n.inclusion?.length) ? 'Edit exceptions' : 'Add exceptions', `notify_exceptions_${record.id}`).row()
    .text('« Back to Address', `open_${record.id}`)
}

function notificationsText(record) {
  const n = normalizeSettings(record)
  const describe = (words) => escapeHtml(menuLabel(words.map((word) => word || '(empty comment)').join(', '), 1000))
  const exclusions = n.exceptions?.length ? describe(n.exceptions) : '<b>disabled</b>'
  const inclusions = n.inclusion?.length ? describe(n.inclusion) : '<b>disabled</b>'
  const dust = config.minIncomingGramNano === '0' ? 'Small incoming filter is disabled globally.'
    : `Small incoming filter: ${n.filter_dust !== false ? 'ON' : 'OFF'}. Hides successful incoming GRAM transfers below ${formatUnits(config.minIncomingGramNano)} GRAM. Outgoing transfers and other event types are unaffected by this filter.`
  return `Here you can set notifications.\n\n${dust}\n\nExceptions: ${exclusions}\nInclusion: ${inclusions}`
}

module.exports = { reply, menuLabel, listKeyboard, addressKeyboard, notificationsKeyboard, notificationsText }
