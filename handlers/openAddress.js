const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const { PAGINATION_LIMIT } = require('../constants')
const getAddressMenuKeyboard = require('../keyboards/addressMenu')
const formatAddress = require('../utils/formatAddress')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const address = await addressRepository.getOneById(addressId)
  const addressString = address.address

  const addressPage = await addressRepository.getAddressPaginationPage(
    ctx.from.id,
    addressString,
    PAGINATION_LIMIT,
  )

  return ctx.editMessageText(
    ctx.i18n.t('address.chosen', {
      address: addressString,
      formatAddress,
      tag: address.tag,
    }),
    Extra.HTML().webPreview(false).markup(getAddressMenuKeyboard(address, ctx.me, addressPage, ctx.i18n)),
  )
}
