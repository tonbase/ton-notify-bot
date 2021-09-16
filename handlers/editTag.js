const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressMenuKeyboard = require('../keyboards/addressMenu')
const formatAddress = require('../utils/formatAddress')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id
  const tag = ctx.message.text

  const addressRepository = new AddressRepository()
  await addressRepository.updateTag(addressId, tag)
  const { _id, notifications, address } = await addressRepository.getOneById(
    addressId,
  )

  await ctx.replyWithHTML(ctx.i18n.t('address.tag-edited', { address }))
  await ctx.replyWithHTML(
    ctx.i18n.t('address.chosen', {
      address,
      format_address: formatAddress,
      tag: ` ${tag}`,
    }),
    Extra.markup(
      getAddressMenuKeyboard({ _id, notifications, address }, ctx.me, ctx.i18n),
    ),
  )
}
