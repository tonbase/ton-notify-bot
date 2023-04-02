const { Markup: m } = require('telegraf')

module.exports = (addressId, notifications, i18n) => {
  return m.inlineKeyboard(
    [
      m.callbackButton(
        i18n.t('buttons.notifications.clear'),
        'clear_inclusion',
        !notifications.inclusion.length,
      ),
      m.callbackButton(i18n.t('buttons.backToNotifications'), `notify_${addressId}`),
    ],
    { columns: 1 },
  )
}
