const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getUndoDeleteKeyboard = require('../keyboards/undoDelete')
const formatAddress = require('../utils/formatAddress')
const formatTag = require('../utils/formatTag')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  await addressRepository.softDeleteOne(addressId)

  const { _id, address, tag } = await addressRepository.getOneById(addressId)

  return ctx.editMessageText(
    ctx.i18n.t('address.deleted', {
      address,
      tag,
      format_address: formatAddress,
      format_tag: formatTag,
    }),
    Extra.HTML().markup(getUndoDeleteKeyboard(_id, false, ctx.i18n)),
  )
}
