const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')
const getNotificationsMenu = require('../utils/formatNotificationsMenu')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id
  const rawListOfInclusion = ctx.message.text
    .split(',')
    .map(
      (v) => v.trim().replace(/\n/g, ''),
    )

  const listOfInclusion = [...new Set(rawListOfInclusion)]

  const addressRepository = new AddressRepository()
  await addressRepository.updateInclusion(addressId, listOfInclusion)

  const { _id, notifications } = await addressRepository.getOneById(addressId)

  ctx.scene.leave()

  return ctx.replyWithHTML(
    getNotificationsMenu(notifications, ctx.i18n),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
  )
}
