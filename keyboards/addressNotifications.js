const { Markup: m } = require('telegraf')

module.exports = (address, i18n) => {
  const { _id, notifications } = address

  const { is_enabled: isEnabled, min_amount: minAmout } = notifications
  return m.inlineKeyboard(
    [
      m.callbackButton(
        i18n.t('buttons.notifications.send', { state: isEnabled ? 'Yes' : 'No' }),
        `notify_${_id}_${isEnabled ? 'off' : 'on'}`,
      ),
      m.callbackButton(
        i18n.t('buttons.notifications.minAmount', { state: minAmout === '0' ? 'OFF' : `💎 ${minAmout} TON` }),
        `notify_min_amout_${_id}`,
        !isEnabled
      ),
      m.callbackButton(i18n.t('buttons.backToAddress'), `open_${_id}`),
    ],
    { columns: 1 },
  )
}
