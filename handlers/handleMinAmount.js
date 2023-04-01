const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getEditMinAmountKeyboard = require('../keyboards/editMinAmount')
const formatAddress = require('../utils/formatAddress')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const {
    _id, address, tag,
    is_deleted: isDeleted,
    notifications,
  } = await addressRepository.getOneById(addressId)

  if (isDeleted) {
    return ctx.answerCbQuery()
  }

  await ctx.editMessageText(
    ctx.i18n.t('address.notifications.editMinAmount', {
      tag,
      address,
      formatAddress,
    }),
    Extra.HTML().webPreview(false).markup(getEditMinAmountKeyboard(_id, notifications, ctx.i18n)),
  )

  return ctx.scene.enter('editMinAmount', { address_id: addressId })
}
