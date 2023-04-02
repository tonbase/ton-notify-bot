module.exports = (notifications, i18n) => {
  const { exceptions, inclusion } = notifications
  const exceptionsList = exceptions.length
    ? i18n.t('address.notifications.exceptionsList', { list: exceptions.join(', ') })
    : i18n.t('address.notifications.zeroExceptions')

  const inclusionList = inclusion.length
    ? i18n.t('address.notifications.inclusionList', { list: inclusion.join(', ') })
    : i18n.t('address.notifications.zeroInclusion')

  return i18n.t(
    'address.notifications.menu',
    { inclusion: inclusionList, exceptions: exceptionsList },
  )
}
