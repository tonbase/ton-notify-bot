const { Markup: m } = require('telegraf')

module.exports = (address, botUsername, addressPage, i18n) => {
  const { _id, address: addressId, notifications } = address

  const notificationsState = notifications.is_enabled
    ? i18n.t('buttons.notifications.On')
    : i18n.t('buttons.notifications.Off')

  return m.inlineKeyboard(
    [
      [
        m.callbackButton(
          i18n.t('buttons.notifications.text', { state: notificationsState }),
          `notify_${_id}`,
        ),
        m.callbackButton(i18n.t('buttons.editTag'), `edit_${_id}`),
      ],
      [
        m.switchToChatButton(
          i18n.t('buttons.shareAddress'),
          i18n.t('address.share', { address: addressId, username: botUsername }),
        ),
        m.callbackButton(i18n.t('buttons.deleteAddress'), `delete_${_id}`),
      ],
      [
        m.callbackButton(i18n.t('buttons.backToList'), `list_${addressPage}`),
      ],
    ],
  )
}
