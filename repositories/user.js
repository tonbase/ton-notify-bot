const UserModel = require('../models/user')

class UserRepository {
  getOneById(id) {
    return UserModel.findById(id)
  }

  getOneByTgId(userId) {
    return UserModel.findOne({ user_id: userId })
  }

  getByTgId(userId, filter = {}) {
    return UserModel.find({ user_id: userId, ...filter })
  }

  create(user) {
    return UserModel.create(user)
  }

  softDeleteOne(userId) {
    return UserModel.updateOne(
      { user_id: userId },
      { $set: { is_deleted: true } },
    )
  }

  restoreOne(userId) {
    return UserModel.updateOne(
      { user_id: userId },
      { $set: { is_deleted: false } },
    )
  }
}

module.exports = UserRepository
