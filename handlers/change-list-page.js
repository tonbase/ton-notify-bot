const AddressRepository = require('../repositories/address');
const pagination = require('../services/pagination');
const getAddressesListKeyboard = require('../keyboards/addresses-list');

module.exports = async (ctx) => {
  const [offsetStr] = ctx.match;
  const offset = Number(offsetStr) || 0;

  const addressRepository = new AddressRepository();
  const { addresses, paginationOptions } = await pagination(
    ctx.from.id,
    addressRepository,
    offset,
  );

  if (!addresses) {
    return;
  }
  await ctx.editMessageReplyMarkup(
    getAddressesListKeyboard(addresses, paginationOptions, ctx.i18n),
  );
};
