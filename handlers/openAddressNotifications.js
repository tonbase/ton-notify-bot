const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const address = await addressRepository.getOneById(addressId)

  const { exceptions } = address.notifications
  const exceptionsList = exceptions.length
    ? ctx.i18n.t('address.notifications.exceptionsList', { list: exceptions.join(', ') })
    : ctx.i18n.t('address.notifications.zeroExceptions')

  return ctx.editMessageText(
    ctx.i18n.t(
      'address.notifications.menu',
      { exceptions: exceptionsList },
    ),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard(address, ctx.i18n)),
  )
}
