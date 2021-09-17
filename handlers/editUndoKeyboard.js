const getUndoDeleteKeyboard = require('../keyboards/undoDelete')

module.exports = (ctx) => {
  const [addressId] = ctx.match

  ctx.editMessageReplyMarkup(getUndoDeleteKeyboard(addressId, true, ctx.i18n))
}
