const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressMenuKeyboard = require('../keyboards/address_menu')
const formatAddress = require('../utils/format_address')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const address = await addressRepository.getOneById(addressId)

  await ctx.editMessageText(
    ctx.i18n.t('address.chosen', {
      address: address.address,
      format_address: formatAddress,
      tag: address.tag,
    }),
    Extra.HTML().markup(getAddressMenuKeyboard(address, ctx.me, ctx.i18n)),
  )
}
