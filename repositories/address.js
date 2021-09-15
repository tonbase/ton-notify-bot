const AddressModel = require('../models/address')

class AddressRepository {
  getOneById(id) {
    return AddressModel.findById(id)
  }

  getOneByAddress(address, filter = {}) {
    return AddressModel.findOne({ address, ...filter })
  }

  getByAddress(address, filter = {}) {
    return AddressModel.find({ address, ...filter })
  }

  async paginationByUserId(userId, offset = 0, limit) {
    const result = await AddressModel.aggregate([
      {
        $facet: {
          addresses: [
            { $match: { user_id: userId } },
            { $skip: offset },
            { $limit: limit },
          ],
          total_count: [{ $match: { user_id: userId } }, { $count: 'count' }],
        },
      },
    ])

    const { addresses, total_count: totalCount } = result[0]
    return { addresses, total_count: totalCount[0].count }
  }

  create(address) {
    return AddressModel.create(address)
  }

  updateTag(addressId, tag) {
    return AddressModel.updateOne({ _id: addressId }, { $set: { tag } })
  }

  turnOnNotifications(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { notifications: true } },
    )
  }

  turnOfNotifications(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { notifications: false } },
    )
  }

  softDeleteOne(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { is_deleted: true } },
    )
  }

  restoreOne(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { is_deleted: false } },
    )
  }
}

module.exports = AddressRepository
