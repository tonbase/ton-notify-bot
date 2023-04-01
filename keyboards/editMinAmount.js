const { Markup: m } = require('telegraf')

module.exports = (addressId, notifications, i18n) => {
  return m.inlineKeyboard(
    [
      m.callbackButton(
        i18n.t('buttons.notifications.resetMinAmount'),
        'reset_min_amount',
        String(notifications.min_amount) === '0',
      ),
      m.callbackButton(i18n.t('buttons.backToNotifications'), `notify_${addressId}`),
    ],
    { columns: 1 },
  )
}
