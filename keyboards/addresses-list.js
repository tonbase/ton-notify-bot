const { Markup: m } = require('telegraf');
const formatAddress = require('../utils/format-address');

module.exports = (addresses, pagination, i18n) => {
  const buttons = addresses.map(({ _id, address, tag }) => {
    const text = tag
      ? `${tag}: ${formatAddress(address)}`
      : formatAddress(address);
    return [m.callbackButton(text, `open_${_id}`)];
  });

  const navigationButtons = [];

  if (!pagination.isFirstPage) {
    navigationButtons.push(
      m.callbackButton(
        i18n.t('buttons.prev-page'),
        `list_${pagination.prevOffset}`,
      ),
    );
  }

  if (!pagination.isLastPage) {
    navigationButtons.push(
      m.callbackButton(
        i18n.t('buttons.next-page'),
        `list_${pagination.nextOffset}`,
      ),
    );
  }

  return m.inlineKeyboard([...buttons, navigationButtons]);
};
