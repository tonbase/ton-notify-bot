const { Markup: m } = require('telegraf')

module.exports = (address, botUsername, i18n) => {
  const { _id, notifications, address: addressId } = address
  const notificationsState = notifications
    ? i18n.t('buttons.notifications-on')
    : i18n.t('buttons.notifications-off')

  return m.inlineKeyboard(
    [
      m.callbackButton(
        i18n.t('buttons.notifications', { state: notificationsState }),
        `notify_${_id}_${notifications ? 'on' : 'off'}`,
      ),
      m.callbackButton(i18n.t('buttons.edit-tag'), `edit_${_id}`),
      m.switchToChatButton(
        i18n.t('buttons.share-address'),
        i18n.t('address.share', { address: addressId, username: botUsername }),
      ),
      m.callbackButton(i18n.t('buttons.delete-address'), `delete_${_id}`),
      m.callbackButton(i18n.t('buttons.back-to-list'), 'list_0'),
    ],
    { columns: 2 },
  )
}
