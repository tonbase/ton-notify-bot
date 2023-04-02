const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')
const getNotificationsMenu = require('../utils/formatNotificationsMenu')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id
  const rawListOfExceptions = ctx.message.text
    .split(',')
    .map(
      (v) => v.trim().replace(/\n/g, ''),
    )

  const listOfExceptions = [...new Set(rawListOfExceptions)]

  const addressRepository = new AddressRepository()
  await addressRepository.updateExceptions(addressId, listOfExceptions)

  const { _id, notifications } = await addressRepository.getOneById(addressId)

  ctx.scene.leave()

  return ctx.replyWithHTML(
    getNotificationsMenu(notifications, ctx.i18n),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
  )
}
