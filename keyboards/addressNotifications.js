const { Markup: m } = require('telegraf')
const ton = require('../services/ton')

module.exports = (address, i18n) => {
  const { _id, notifications } = address

  const { is_enabled: isEnabled, min_amount: minAmout, exceptions, inclusion } = notifications

  const exceptionsButton = exceptions.length || inclusion.length
    ? i18n.t('buttons.notifications.editExceptions')
    : i18n.t('buttons.notifications.addExceptions')

  const stringAmount = String(minAmout)
  return m.inlineKeyboard(
    [
      m.callbackButton(
        i18n.t('buttons.notifications.send', { state: isEnabled ? 'Yes' : 'No' }),
        `notify_${_id}_${isEnabled ? 'off' : 'on'}`,
      ),
      m.callbackButton(
        i18n.t(
          'buttons.notifications.minAmount',
          {
            state: stringAmount === '0' ? 'OFF' : `${ton.utils.fromNano(stringAmount)} TON`,
          },
        ),
        `notify_min_amout_${_id}`,
        !isEnabled,
      ),
      m.callbackButton(
        exceptionsButton,
        `notify_exceptions_${_id}`,
        !isEnabled,
      ),
      m.callbackButton(i18n.t('buttons.backToAddress'), `open_${_id}`),
    ],
    { columns: 1 },
  )
}
