const { Markup: m } = require('telegraf')

module.exports = (addressId, isHideSetTagButton, i18n) => {
  return m.inlineKeyboard([
    m.callbackButton(i18n.t('buttons.setTag'), `edit_${addressId}`, isHideSetTagButton),
    m.callbackButton(i18n.t('buttons.openAddress'), `open_${addressId}`),
  ])
}
