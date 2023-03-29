const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const pagination = require('../services/pagination')
const getAddressesListKeyboard = require('../keyboards/addressesList')

module.exports = async (ctx) => {
  const [offsetStr] = ctx.match
  const offset = Number(offsetStr) || 0

  const addressRepository = new AddressRepository()
  const { addresses, total_count } = await pagination(
    ctx.from.id,
    addressRepository,
    offset,
  )

  if (!addresses) {
    return false
  }

  const paginationOptions = { current: offset, total_count }
  return ctx.editMessageText(
    ctx.i18n.t('list.chooseAddress'),
    Extra.markup(getAddressesListKeyboard(addresses, paginationOptions)),
  )
}
