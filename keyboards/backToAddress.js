const { Markup: m } = require('telegraf')

module.exports = (addressId, i18n) => {
  return m.inlineKeyboard([m.callbackButton(i18n.t('buttons.backToAddress'), `open_${addressId}`)])
}
