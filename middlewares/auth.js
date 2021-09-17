const UserRepository = require('../repositories/user')

module.exports = async (ctx, next) => {
  const { from } = ctx

  if (!from) {
    return next()
  }

  const params = {
    user_id: from.id,
    first_name: from.first_name,
    last_name: from.last_name || '',
    language_code: from.language_code || '',
    last_activity_at: new Date(),
  }
  const userRepository = new UserRepository()

  try {
    const user = await userRepository.create(params)
    ctx.user = user.toJSON()
  } catch (err) {
    if (err.code !== 11000) {
      throw err
    }

    const user = await userRepository.getOneAndUpdateByTgId(from.id, params)
    ctx.user = user.toJSON()
  }

  return next()
}
