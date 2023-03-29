const getUndoDeleteKeyboard = require('../keyboards/undoDelete')

module.exports = (ctx) => {
  const addressId = ctx.match[1]

  return ctx.editMessageReplyMarkup(getUndoDeleteKeyboard(addressId, true, null, ctx.i18n))
}
