const { PAGINATION_LIMIT } = require('../constants')

module.exports = async (userId, addressRepository, offset) => {
  const { addresses, total_count } =
    await addressRepository.paginationByUserId(
      userId,
      offset,
      PAGINATION_LIMIT,
      { is_deleted: false },
    )

  if (!addresses.length) {
    return {}
  }

  return { addresses, total_count }
}
