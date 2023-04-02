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
  const exceptionsList = exceptions.length
    ? ctx.i18n.t('address.notifications.exceptionsList', { list: exceptions.join(', ') })
    : ctx.i18n.t('address.notifications.zeroExceptions')

  const inclusionList = inclusion.length
    ? ctx.i18n.t('address.notifications.inclusionList', { list: inclusion.join(', ') })
    : ctx.i18n.t('address.notifications.zeroInclusion')

  await ctx.editMessageText(
    ctx.i18n.t('address.notifications.editExceptions', {
      inclusion: inclusionList, exceptions: exceptionsList,
    }),
    Extra.HTML()
      .webPreview(false)
      .markup(getEditExceptionsKeyboard(_id, notifications, ctx.i18n)),
  )

  return ctx.scene.enter('editExceptions', { address_id: addressId })
}
