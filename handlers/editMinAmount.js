const { Extra } = require('telegraf')
const { Big } = require('../utils/big')
const AddressRepository = require('../repositories/address')
const getBackToNotificationsKeyboard = require('../keyboards/backToNotifications')
const getAddressNotificationsKeyboard = require('../keyboards/addressNotifications')
const ton = require('../services/ton')
const log = require('../utils/log')

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
    const nanoAmount = ton.utils.toNano(val.toString()).toString(10)

    const addressRepository = new AddressRepository()
    await addressRepository.updateMinAmount(addressId, nanoAmount)

    const { _id, notifications } = await addressRepository.getOneById(addressId)

    ctx.scene.leave()

    return ctx.replyWithHTML(
      ctx.i18n.t('address.notifications.menu'),
      Extra.HTML()
        .webPreview(false)
        .markup(getAddressNotificationsKeyboard({ _id, notifications }, ctx.i18n)),
    )
  } catch (error) {
    log.error(`Editing minimal amount error: ${error}`)
    return ctx.replyWithHTML(
      ctx.i18n.t('address.notifications.invalid'),
      Extra.HTML().webPreview(false).markup(getBackToNotificationsKeyboard(addressId, ctx.i18n)),
    )
  }
}
