const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const TonApi = require('../services/ton_api')
const getOpenAddressKeyboard = require('../keyboards/open_address')
const getAddressMenuKeyboard = require('../keyboards/address_menu')
const formatAddress = require('../utils/format_address')
const formatTag = require('../utils/format_tag')

module.exports = async (ctx) => {
  const [address = ctx.startPayload, tag] = ctx.match
    ? ctx.match[0].split(':')
    : []

  const api = new TonApi()
  const response = await api.getAddressInformation(address)

  if (!response.ok) {
    return
  }

  const addressRepository = new AddressRepository()
  const userId = ctx.from.id

  try {
    const { _id } = await addressRepository.create({
      user_id: userId,
      address,
      tag,
    })

    await ctx.replyWithHTML(
      ctx.i18n.t('address.added', {
        address,
        tag,
        format_address: formatAddress,
        format_tag: formatTag,
      }),
      Extra.markup(getOpenAddressKeyboard(_id, !!tag, ctx.i18n)).webPreview(
        false,
      ),
    )
  } catch (err) {
    if (err.code !== 11000) {
      throw err
    }

    const {
      _id,
      notifications,
      tag: oldTag,
    } = await addressRepository.getOneByAddress(address)

    await ctx.replyWithHTML(
      ctx.i18n.t('address.chosen', {
        address,
        format_address: formatAddress,
        tag: oldTag ? ` ${oldTag}` : '',
      }),
      Extra.markup(
        getAddressMenuKeyboard(
          { _id, notifications, address },
          ctx.me,
          ctx.i18n,
        ),
      ),
    )
  }
}
