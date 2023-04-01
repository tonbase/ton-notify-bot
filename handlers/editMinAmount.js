const { Extra } = require('telegraf')
const Big = require('big.js')
const AddressRepository = require('../repositories/address')
const getBackToNotificationsKeyboard = require('../keyboards/backToNotifications')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id
  const minAmount = ctx.message.text

  try {
    // eslint-disable-next-line no-new
    const val = new Big(minAmount)
    if (val.lt(0)) {
      throw new Error('Value less than 0')
    }
    if (val.gt(5e9)) {
      throw new Error('Value more than 5 000 000 000')
    }
  } catch (error) {
    return ctx.replyWithHTML(
      ctx.i18n.t('address.notifications.invalid'),
      Extra.HTML().webPreview(false).markup(getBackToNotificationsKeyboard(addressId, ctx.i18n)),
    )
  }

  const addressRepository = new AddressRepository()
  await addressRepository.updateMinAmount(addressId, Number(minAmount))

  const { _id, notifications } = await addressRepository.getOneById(addressId)

  return ctx.replyWithHTML(
    ctx.i18n.t('address.notifications.menu'),
    Extra.HTML()
      .webPreview(false)
      .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
  )
}
