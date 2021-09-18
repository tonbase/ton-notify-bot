const { Extra } = require('telegraf')
const AddressRepository = require('../repositories/address')
const ton = require('../services/ton')
const getOpenAddressKeyboard = require('../keyboards/openAddress')
const getAddressMenuKeyboard = require('../keyboards/addressMenu')
const formatAddress = require('../utils/formatAddress')
const formatTag = require('../utils/formatTag')

module.exports = async (ctx) => {
  const [address = ctx.startPayload, tag] = ctx.match
    ? ctx.match[0].split(':')
    : []

  try {
    await ton.provider.send('getAddressInformation', { address })
  } catch (err) {
    return false
  }

  const addressRepository = new AddressRepository()
  const userId = ctx.from.id

  const addressAddedText = ctx.i18n.t('address.added', {
    address,
    tag,
    format_address: formatAddress,
    format_tag: formatTag,
  })

  try {
    const { _id } = await addressRepository.create({
      user_id: userId,
      address,
      tag,
    })

    return ctx.replyWithHTML(
      addressAddedText,
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
      is_deleted: isDeleted,
    } = await addressRepository.getOneByAddress(address, { user_id: userId })

    if (isDeleted) {
      await addressRepository.updateOneById(_id, {
        is_deleted: false,
        tag: tag || '',
      })

      return ctx.replyWithHTML(
        addressAddedText,
        Extra.markup(getOpenAddressKeyboard(_id, !!tag, ctx.i18n)).webPreview(
          false,
        ),
      )
    }

    return ctx.replyWithHTML(
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
