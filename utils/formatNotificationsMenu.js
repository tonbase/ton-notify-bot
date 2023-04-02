module.exports = (notifications, i18n) => {
  const { exceptions } = notifications
  const exceptionsList = exceptions.length
    ? i18n.t('address.notifications.exceptionsList', { list: exceptions.join(', ') })
    : i18n.t('address.notifications.zeroExceptions')

  return i18n.t(
    'address.notifications.menu',
    { exceptions: exceptionsList },
  )
}
