const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getBackToAddressKeyboard = require('../keyboards/back_to_address')
const formatAddress = require('../utils/format_address')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const {
    _id,
    address,
    is_deleted: isDelete,
  } = await addressRepository.getOneById(addressId)

  if (isDelete) {
    return
  }

  ctx.session.address_id_for_edit = _id

  await ctx.editMessageText(
    ctx.i18n.t('address.send-tag', { address, format_address: formatAddress }),
    Extra.HTML().markup(getBackToAddressKeyboard(_id, ctx.i18n)),
  )
}
