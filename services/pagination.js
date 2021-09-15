const { PAGINATION_LIMIT } = require('../constants');

module.exports = async (userId, addressRepository, offset) => {
  const { addresses, totalCount } = await addressRepository.paginationByUserId(
    userId,
    offset,
    PAGINATION_LIMIT,
  );

  if (!addresses.length) {
    return {};
  }

  const isFirstPage = offset === 0;
  const isLastPage = totalCount <= offset + PAGINATION_LIMIT;
  const paginationOptions = {
    isFirstPage,
    isLastPage,
    prevOffset: isFirstPage ? null : offset - PAGINATION_LIMIT,
    nextOffset: isLastPage ? null : offset + PAGINATION_LIMIT,
  };

  return { addresses, paginationOptions };
};
