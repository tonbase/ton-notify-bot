const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressMenuKeyboard = require('../keyboards/address_menu')
const formatAddress = require('../utils/format_address')

module.exports = async (ctx) => {
  const addressId = ctx.session.address_id_for_edit
  const tag = ctx.message.text
  delete ctx.session.address_id_for_edit

  const addressRepository = new AddressRepository()
  await addressRepository.updateTag(addressId, tag)
  const { _id, notifications, address } = await addressRepository.getOneById(
    addressId,
  )

  await ctx.replyWithHTML(ctx.i18n.t('address.tag-edited', { address }))
  return ctx.replyWithHTML(
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
