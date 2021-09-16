const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const pagination = require('../services/pagination')
const getAddressesListKeyboard = require('../keyboards/addressesList')

module.exports = async (ctx) => {
  const addressRepository = new AddressRepository()
  const { addresses, pagination_options: paginationOptions } = await pagination(
    ctx.from.id,
    addressRepository,
    0,
  )

  if (!addresses) {
    return ctx.replyWithHTML(ctx.i18n.t('list.empty'))
  }

  return ctx.replyWithHTML(
    ctx.i18n.t('list.choose-address'),
    Extra.markup(
      getAddressesListKeyboard(addresses, paginationOptions, ctx.i18n),
    ),
  )
}
