const UserModel = require("../models/user");

class UserRepository {
  getOneById(id) {
    return UserModel.findById(id);
  }

  getOneByTgId(userId) {
    return UserModel.findOne({ userId });
  }

  getByTgId(userId, filter = {}) {
    return UserModel.find({ userId, ...filter });
  }

  create(user) {
    return UserModel.create(user);
  }

  softDeleteOne(userId) {
    return UserModel.updateOne({ userId }, { $set: { isDeleted: true } });
  }

  restoreOne(userId) {
    return UserModel.updateOne({ userId }, { $set: { isDeleted: false } });
  }
}

module.exports = UserRepository;
