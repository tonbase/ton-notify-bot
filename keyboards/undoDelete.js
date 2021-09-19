const { Markup: m } = require('telegraf')

module.exports = (addressId, isHideOpenButton, i18n) => {
  return m.inlineKeyboard(
    [
      m.callbackButton(i18n.t('buttons.undo'), `undo_${addressId}`),
      m.callbackButton(
        i18n.t('buttons.openAddressesList'),
        `open-list_${addressId}`,
        isHideOpenButton,
      ),
    ],
    { columns: 1 },
  )
}
