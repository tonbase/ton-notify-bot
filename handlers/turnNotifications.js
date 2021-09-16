const AddressRepository = require('../repositories/address')
const getAddressMenuKeyboard = require('../keyboards/addressMenu')

module.exports = async (ctx) => {
  const [addressId, currentState] = ctx.match[0].split('_')
  const notifications = currentState !== 'on'

  const addressRepository = new AddressRepository()

  if (notifications) {
    await addressRepository.turnOnNotifications(addressId)
  } else {
    await addressRepository.turnOfNotifications(addressId)
  }

  const address = await addressRepository.getOneById(addressId)

  return ctx.editMessageReplyMarkup(
    getAddressMenuKeyboard(address, ctx.me, ctx.i18n),
  )
}
