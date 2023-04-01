const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id

  const addressRepository = new AddressRepository()
  await addressRepository.resetMinAmount(addressId)

  const { _id, notifications } = await addressRepository.getOneById(addressId)

  ctx.scene.leave()

  return ctx.editMessageText(
    ctx.i18n.t('address.notifications.menu'),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
  )
}
