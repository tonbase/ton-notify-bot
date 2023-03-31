const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getUndoDeleteKeyboard = require('../keyboards/undoDelete')
const formatAddress = require('../utils/formatAddress')
const { PAGINATION_LIMIT } = require('../constants')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const { _id, address, tag } = await addressRepository.getOneById(addressId)

  const addressPage = await addressRepository.getAddressPaginationPage(
    ctx.from.id,
    address,
    PAGINATION_LIMIT,
  )

  const { addresses } = await addressRepository.paginationByUserId(
    ctx.from.id,
    addressPage * PAGINATION_LIMIT,
    PAGINATION_LIMIT,
    { is_deleted: false },
  )

  const returnPage = (addresses.length - 1) < 1 ? addressPage - 1 : addressPage

  await addressRepository.softDeleteOne(addressId)

  return ctx.editMessageText(
    ctx.i18n.t('address.deleted', {
      tag,
      address,
      formatAddress,
    }),
    Extra
      .webPreview(false)
      .HTML()
      .markup(getUndoDeleteKeyboard(_id, false, returnPage, ctx.i18n)),
  )
}
