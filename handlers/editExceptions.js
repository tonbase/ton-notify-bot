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

  const fullListOfExceptions = [...new Set(rawListOfExceptions)]

  const rawExceptions = []
  const rawInclusion = []

  const regexClearType = /^[+-]/;
  fullListOfExceptions.forEach((rawText) => {
    const textType = /^-/.test(rawText) ? '-' : '+'
    const text = rawText.replace(regexClearType, '').trim()

    if (textType === '-') {
      rawExceptions.push(text)
    } else {
      rawInclusion.push(text)
    }
  })

  const exceptions = [...new Set(rawExceptions)]
  const inclusion = [...new Set(rawInclusion)]

  const addressRepository = new AddressRepository()
  await addressRepository.updateExceptions(
    addressId,
    exceptions, inclusion,
  )

  const { _id, notifications } = await addressRepository.getOneById(addressId)

  ctx.scene.leave()

  return ctx.replyWithHTML(
    getNotificationsMenu(notifications, ctx.i18n),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
  )
}
