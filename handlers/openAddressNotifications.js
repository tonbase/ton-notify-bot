const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const address = await addressRepository.getOneById(addressId)

  return ctx.editMessageText(
    ctx.i18n.t('address.notifications.menu'),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard(address, ctx.i18n)),
  )
}
