const { Markup: m } = require('telegraf')

module.exports = (addressId, notifications, i18n) => {
  return m.inlineKeyboard(
    [
      m.callbackButton(
        i18n.t('buttons.notifications.clearExceptions'),
        'clear_exceptions',
        !notifications.exceptions.length,
      ),
      m.callbackButton(i18n.t('buttons.backToNotifications'), `notify_${addressId}`),
    ],
    { columns: 1 },
  )
}
