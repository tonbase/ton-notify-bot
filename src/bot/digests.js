const { Delivery } = require('../models')
const { digestId, loadDigestContents, formatDigest } = require('../digest')
const { renderDigestPage, summaryKeyboard } = require('../digest-format')
const { reply } = require('./views')

async function showDigest(ctx, addressId, startSeconds, page) {
  const start = Number(startSeconds)
  if (!Number.isSafeInteger(start) || start <= 0 || start % 900 !== 0) return reply(ctx, 'This summary is unavailable.')
  const delivery = await Delivery.findOne({ _id: digestId(addressId, start * 1000),
    user_id: String(ctx.from.id), delivery_kind: 'digest' }).lean()
  if (!delivery) return reply(ctx, 'This summary is unavailable.')
  const contents = await loadDigestContents(delivery)
  if (!contents.complete) return reply(ctx, 'Detailed summary history is available for seven days. Open the wallet to see its transactions.',
    summaryKeyboard(delivery, false), true)
  const view = page === 's' ? { text: formatDigest(delivery, contents), reply_markup: summaryKeyboard(delivery, true) }
    : renderDigestPage(delivery, contents, Number(page))
  return reply(ctx, view.text, view.reply_markup, true)
}

module.exports = { showDigest }
