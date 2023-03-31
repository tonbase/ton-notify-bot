const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const getAddressMenuKeyboard = require('../keyboards/addressMenu')
const formatAddress = require('../utils/formatAddress')
const { PAGINATION_LIMIT } = require('../constants')

module.exports = async (ctx) => {
  const addressId = ctx.scene.state.address_id
  const tag = ctx.message.text

  const addressRepository = new AddressRepository()
  await addressRepository.updateTag(addressId, tag)
  const { _id, notifications, address } = await addressRepository.getOneById(addressId)

  const addressPage = await addressRepository.getAddressPaginationPage(
    ctx.from.id,
    address,
    PAGINATION_LIMIT,
  )

  return ctx.replyWithHTML(
    ctx.i18n.t('address.chosen', {
      tag,
      address,
      formatAddress,
    }),
    Extra
      .webPreview(false)
      .markup(
        getAddressMenuKeyboard(
          { _id, notifications, address },
          ctx.me,
          addressPage,
          ctx.i18n,
        ),
      ),
  )
}
