const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const pagination = require('../services/pagination')
const getAddressesListKeyboard = require('../keyboards/addressesList')
const { PAGINATION_LIMIT } = require('../constants')

module.exports = async (ctx) => {
  const addressesPage = ctx.match && ctx.match[2] ? Number(ctx.match[2]) : 0

  const addressRepository = new AddressRepository()
  // eslint-disable-next-line camelcase
  const { addresses, total_count } = await pagination(
    ctx.from.id,
    addressRepository,
    addressesPage * PAGINATION_LIMIT,
  )

  if (!addresses) {
    return ctx.replyWithHTML(ctx.i18n.t('list.empty'))
  }

  const paginationOptions = { current: addressesPage, total_count }
  return ctx.replyWithHTML(
    ctx.i18n.t('list.chooseAddress'),
    Extra.markup(getAddressesListKeyboard(addresses, paginationOptions)).webPreview(
      false,
    ),
  )
}
