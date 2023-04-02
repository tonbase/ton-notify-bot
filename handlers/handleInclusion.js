const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getEditInclusionKeyboard = require('../keyboards/editInclusion')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const {
    _id, is_deleted: isDeleted,
    notifications,
  } = await addressRepository.getOneById(addressId)

  if (isDeleted) {
    return ctx.answerCbQuery()
  }

  const { inclusion } = notifications
  const state = inclusion.length
    ? ctx.i18n.t('address.notifications.inclusionList', { list: inclusion.join(', ') })
    : ctx.i18n.t('address.notifications.zeroInclusion')

  await ctx.editMessageText(
    ctx.i18n.t('address.notifications.editInclusion', { state }),
    Extra.HTML()
      .webPreview(false)
      .markup(getEditInclusionKeyboard(_id, notifications, ctx.i18n)),
  )

  return ctx.scene.enter('editInclusion', { address_id: addressId })
}
