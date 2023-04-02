const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id

  const addressRepository = new AddressRepository()
  await addressRepository.clearExceptions(addressId)

  const { _id, notifications } = await addressRepository.getOneById(addressId)

  ctx.scene.leave()

  const { exceptions } = notifications
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
      .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
  )
}
