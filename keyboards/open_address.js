const { Markup: m } = require('telegraf')

module.exports = (addressId, isHideSetTagButton, i18n) => {
  return m.inlineKeyboard([
    m.callbackButton(
      i18n.t('buttons.set-tag'),
      `edit_${addressId}`,
      isHideSetTagButton,
    ),
    m.callbackButton(i18n.t('buttons.open-address'), `open_${addressId}`),
  ])
}
