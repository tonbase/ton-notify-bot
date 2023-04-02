const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')
const getNotificationsMenu = require('../utils/formatNotificationsMenu')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const address = await addressRepository.getOneById(addressId)

  return ctx.editMessageText(
    getNotificationsMenu(address.notifications, ctx.i18n),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard(address, ctx.i18n)),
  )
}
