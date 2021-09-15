const AddressModel = require('../models/address');

class AddressRepository {
  getOneById(id) {
    return AddressModel.findById(id);
  }

  getOneByAddress(address, filter = {}) {
    return AddressModel.findOne({ address, ...filter });
  }

  getByAddress(address, filter = {}) {
    return AddressModel.find({ address, ...filter });
  }

  async paginationByUserId(userId, offset = 0, limit) {
    const result = await AddressModel.aggregate([
      {
        $facet: {
          addresses: [
            { $match: { userId } },
            { $skip: offset },
            { $limit: limit },
          ],
          totalCount: [{ $match: { userId } }, { $count: 'count' }],
        },
      },
    ]);

    const { addresses, totalCount } = result[0];
    return { addresses, totalCount: totalCount[0].count };
  }

  create(address) {
    return AddressModel.create(address);
  }

  updateTag(addressId, tag) {
    return AddressModel.updateOne({ _id: addressId }, { $set: { tag } });
  }

  turnOnNotifications(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { notifications: true } },
    );
  }

  turnOfNotifications(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { notifications: false } },
    );
  }

  softDeleteOne(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { isDeleted: true } },
    );
  }

  restoreOne(addressId) {
    return AddressModel.updateOne(
      { _id: addressId },
      { $set: { isDeleted: false } },
    );
  }
}

module.exports = AddressRepository;
