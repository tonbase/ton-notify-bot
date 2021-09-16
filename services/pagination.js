const { PAGINATION_LIMIT } = require('../constants')

module.exports = async (userId, addressRepository, offset) => {
  const { addresses, total_count: totalCount } =
    await addressRepository.paginationByUserId(
      userId,
      offset,
      PAGINATION_LIMIT,
      { is_deleted: false },
    )

  if (!addresses.length) {
    return {}
  }

  const isFirstPage = offset === 0
  const isLastPage = totalCount <= offset + PAGINATION_LIMIT
  const paginationOptions = {
    is_first_page: isFirstPage,
    is_last_page: isLastPage,
    prev_offset: isFirstPage ? null : offset - PAGINATION_LIMIT,
    next_offset: isLastPage ? null : offset + PAGINATION_LIMIT,
  }

  return { addresses, pagination_options: paginationOptions }
}
