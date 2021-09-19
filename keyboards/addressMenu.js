const { Markup: m } = require('telegraf')

module.exports = (address, botUsername, i18n) => {
  const { _id, notifications, address: addressId } = address
  const notificationsState = notifications
    ? i18n.t('buttons.notificationsOn')
    : i18n.t('buttons.notificationsOff')

  return m.inlineKeyboard(
    [
      m.callbackButton(
        i18n.t('buttons.notifications', { state: notificationsState }),
        `notify_${_id}_${notifications ? 'on' : 'off'}`,
      ),
      m.callbackButton(i18n.t('buttons.editTag'), `edit_${_id}`),
      m.switchToChatButton(
        i18n.t('buttons.shareAddress'),
        i18n.t('address.share', { address: addressId, username: botUsername }),
      ),
      m.callbackButton(i18n.t('buttons.deleteAddress'), `delete_${_id}`),
      m.callbackButton(i18n.t('buttons.backToList'), 'list_0'),
    ],
    { columns: 2 },
  )
}
