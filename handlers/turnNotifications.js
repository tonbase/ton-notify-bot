const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')

module.exports = async (ctx) => {
  const addressId = ctx.match[1]
  const state = ctx.match[2]

  const notifications = (state === 'on')

  const addressRepository = new AddressRepository()

  if (notifications) {
    await addressRepository.turnOnNotifications(addressId)
  } else {
    await addressRepository.turnOfNotifications(addressId)
  }

  const address = await addressRepository.getOneById(addressId)

  return ctx.editMessageReplyMarkup(
    getAddressNotificationsKeyboard(address, ctx.i18n),
  )
}
