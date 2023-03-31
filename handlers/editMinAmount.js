const { Extra } = require('telegraf')
const Big = require('big.js')
const AddressRepository = require('../repositories/address')
const getBackToAddressKeyboard = require('../keyboards/backToAddress')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id
  const minAmount = ctx.message.text

  try {
    // eslint-disable-next-line no-new
    new Big(minAmount)
  } catch (error) {
    return ctx.replyWithHTML(
      ctx.i18n.t('address.notifications.invalid'),
      Extra.HTML().webPreview(false).markup(getBackToAddressKeyboard(addressId, ctx.i18n)),
    )
  }

  const addressRepository = new AddressRepository()
  await addressRepository.updateMinAmount(addressId, minAmount)

  const { _id, notifications } = await addressRepository.getOneById(addressId)

  return ctx.replyWithHTML(
    ctx.i18n.t('address.notifications.menu'),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
  )
}
