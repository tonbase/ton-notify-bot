const { Markup: m } = require('telegraf')

module.exports = (addressId, i18n) => {
  return m.inlineKeyboard(
    [
      m.callbackButton(i18n.t('buttons.undo'), `undo_${addressId}`),
      m.callbackButton(i18n.t('buttons.open-addresses-lit'), 'list_0'),
    ],
    { columns: 1 },
  )
}
