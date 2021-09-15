const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const pagination = require('../services/pagination')
const getAddressesListKeyboard = require('../keyboards/addresses_list')

module.exports = async (ctx) => {
  const [offsetStr] = ctx.match
  const offset = Number(offsetStr) || 0

  const addressRepository = new AddressRepository()
  const { addresses, pagination_options: paginationOptions } = await pagination(
    ctx.from.id,
    addressRepository,
    offset,
  )

  if (!addresses) {
    return
  }
  await ctx.editMessageText(
    ctx.i18n.t('list.choose-address'),
    Extra.markup(
      getAddressesListKeyboard(addresses, paginationOptions, ctx.i18n),
    ),
  )
}
