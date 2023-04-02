const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getEditExceptionsKeyboard = require('../keyboards/editExceptions')

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

  const { exceptions, inclusion } = notifications

  const totalList = []
  inclusion.forEach((inclus) => {
    totalList.push(`+${inclus}`)
  })
  exceptions.forEach((exception) => {
    totalList.push(`-${exception}`)
  })

  await ctx.editMessageText(
    ctx.i18n.t('address.notifications.editExceptions', {
      current: totalList.length
        ? ctx.i18n.t('address.notifications.currentList', { list: totalList.join(', ') })
        : ctx.i18n.t('address.notifications.zeroExceptions'),
    }),
    Extra.HTML()
      .webPreview(false)
      .markup(getEditExceptionsKeyboard(_id, notifications, ctx.i18n)),
  )

  return ctx.scene.enter('editExceptions', { address_id: addressId })
}
