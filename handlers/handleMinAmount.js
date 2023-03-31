const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getBackToAddressKeyboard = require('../keyboards/backToAddress')
const formatAddress = require('../utils/formatAddress')
const formatTag = require('../utils/formatTag')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const {
    _id, address, tag,
    is_deleted: isDeleted,
  } = await addressRepository.getOneById(addressId)

  if (isDeleted) {
    return ctx.answerCbQuery()
  }

  await ctx.editMessageText(
    ctx.i18n.t('address.notifications.edit', {
      address,
      formatAddress,
      tag: formatTag(tag),
    }),
    Extra.HTML().webPreview(false).markup(getBackToAddressKeyboard(_id, ctx.i18n)),
  )

  return ctx.scene.enter('editMinAmout', { address_id: addressId })
}
