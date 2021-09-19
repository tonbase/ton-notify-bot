const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getBackToAddressKeyboard = require('../keyboards/backToAddress')
const formatAddress = require('../utils/formatAddress')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const { _id, address, is_deleted: isDeleted } = await addressRepository.getOneById(addressId)

  if (isDeleted) {
    return false
  }

  await ctx.editMessageText(
    ctx.i18n.t('address.sendTag', { address, formatAddress }),
    Extra.HTML().markup(getBackToAddressKeyboard(_id, ctx.i18n)),
  )

  return ctx.scene.enter('editTag', { address_id: addressId })
}
