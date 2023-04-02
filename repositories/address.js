const AddressModel = require('../models/address')

class AddressRepository {
  getOneById(id) {
    return AddressModel.findById(id)
  }

  getOneByAddress(address, filter = {}) {
    return AddressModel.findOne({ address, ...filter })
  }

  getByAddress(address, filter = {}) {
    const wrapped = Array.isArray(address) ? address : [address]
    return AddressModel.find({ address: { $in: wrapped }, ...filter })
  }

  async getAddressPaginationPage(userId, address, pagination) {
    const result = await AddressModel.aggregate([
      {
        $facet: {
          addresses: [
            { $match: { user_id: userId, is_deleted: false } },
            { $skip: 0 },
          ],
        },
      },
    ])

    const { addresses } = result[0]
    const index = addresses.findIndex((v) => v.address === address)
    if (index === -1) {
      return 1
    }

    return Math.floor(index / pagination)
  }

  async paginationByUserId(userId, offset = 0, limit, filter = {}) {
    const result = await AddressModel.aggregate([
      {
        $facet: {
          addresses: [
            { $match: { user_id: userId, ...filter } },
            { $skip: offset },
            { $limit: limit },
          ],
          total_count: [{ $match: { user_id: userId, ...filter } }, { $count: 'count' }],
        },
      },
    ])

    const { addresses, total_count: totalCount } = result[0]
    return { addresses, total_count: totalCount[0] && totalCount[0].count }
  }

  create(address) {
    return AddressModel.create(address)
  }

  updateOneById(addressId, update) {
    return AddressModel.updateOne({ _id: addressId }, { $set: update })
  }

  updateTag(addressId, tag) {
    return AddressModel.updateOne({ _id: addressId }, { $set: { tag } })
  }

  updateMinAmount(addressId, amount) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { 'notifications.min_amount': amount } },
    )
  }

  resetMinAmount(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { 'notifications.min_amount': '0' } },
    )
  }

  updateExceptions(addressId, exceptions, inclusion) {
    return AddressModel.updateOne(
      { _id: addressId },
      {
        $set: {
          'notifications.exceptions': exceptions,
          'notifications.inclusion': inclusion,
        },
      },
    )
  }

  clearExceptions(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      {
        $set: {
          'notifications.exceptions': [],
          'notifications.inclusion': [],
        },
      },
    )
  }

  incSendCoinsCounter(addressId, value) {
    return AddressModel.updateOne({ _id: addressId }, { $inc: { 'counters.send_coins': value } })
  }

  turnOnNotifications(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { 'notifications.is_enabled': true } },
    )
  }

  turnOfNotifications(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { 'notifications.is_enabled': false } },
    )
  }

  softDeleteOne(addressId) {
    return AddressModel.updateOne({ _id: addressId }, { $set: { is_deleted: true } })
  }

  restoreOne(addressId) {
    return AddressModel.updateOne({ _id: addressId }, { $set: { is_deleted: false } })
  }
}

module.exports = AddressRepository
