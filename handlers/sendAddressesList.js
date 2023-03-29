const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const pagination = require('../services/pagination')
const getAddressesListKeyboard = require('../keyboards/addressesList')

module.exports = async (ctx) => {
  const addressRepository = new AddressRepository()
  const { addresses, total_count } = await pagination(
    ctx.from.id,
    addressRepository,
    0,
  )

  if (!addresses) {
    return ctx.replyWithHTML(ctx.i18n.t('list.empty'))
  }

  const paginationOptions = { current: 0, total_count }
  return ctx.replyWithHTML(
    ctx.i18n.t('list.chooseAddress'),
    Extra.markup(getAddressesListKeyboard(addresses, paginationOptions)).webPreview(
      false,
    ),
  )
}
