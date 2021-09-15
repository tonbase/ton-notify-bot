const { Extra } = require('telegraf');
const AddressRepository = require('../repositories/address');
const TonApi = require('../services/tonApi');
const getOpenAddressKeyboard = require('../keyboards/open-address');
const getAddressMenuKeyboard = require('../keyboards/address-menu');
const formatAddress = require('../utils/format-address');

module.exports = async (ctx) => {
  const [address, tag] = ctx.message.text.split(':');

  const api = new TonApi();
  const response = await api.getAddressInformation(address);

  if (!response.ok) {
    return;
  }

  const addressRepository = new AddressRepository();
  const userId = ctx.from.id;

  try {
    const { _id } = await addressRepository.create({ userId, address, tag });

    await ctx.replyWithHTML(
      ctx.i18n.t('address.added', { address, tag, formatAddress }),
      Extra.markup(getOpenAddressKeyboard(_id, ctx.i18n)).webPreview(false),
    );
  } catch (err) {
    if (err.code !== 11000) {
      throw err;
    }

    const {
      _id,
      notifications,
      tag: oldTag,
    } = await addressRepository.getOneByAddress(address);

    await ctx.replyWithHTML(
      ctx.i18n.t('address.chosen', { address, formatAddress, tag: oldTag }),
      Extra.markup(
        getAddressMenuKeyboard(
          { _id, notifications, address },
          ctx.me,
          ctx.i18n,
        ),
      ),
    );
  }
};
