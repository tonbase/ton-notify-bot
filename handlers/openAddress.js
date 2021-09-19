const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressMenuKeyboard = require('../keyboards/addressMenu')
const formatAddress = require('../utils/formatAddress')

module.exports = async (ctx) => {
  const [addressId] = ctx.match

  const addressRepository = new AddressRepository()
  const address = await addressRepository.getOneById(addressId)

  return ctx.editMessageText(
    ctx.i18n.t('address.chosen', {
      address: address.address,
      formatAddress,
      tag: address.tag ? ` ${address.tag}` : '',
    }),
    Extra.HTML().markup(getAddressMenuKeyboard(address, ctx.me, ctx.i18n)),
  )
}
