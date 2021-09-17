const UserRepository = require('../repositories/user')

module.exports = async (ctx, next) => {
  if (ctx.update?.my_chat_member?.chat?.type !== 'private') {
    return next()
  }
  if (!ctx.update?.my_chat_member?.new_chat_member?.status) {
    return next()
  }

  const userId = ctx.update.my_chat_member.chat.id
  const userRepository = new UserRepository()

  if (ctx.update?.my_chat_member?.new_chat_member?.status === 'kicked') {
    return userRepository.getOneAndUpdateByTgId(userId, {
      is_blocked: true,
    })
  } else if (ctx.update?.my_chat_member?.new_chat_member?.status === 'member') {
    return userRepository.getOneAndUpdateByTgId(userId, {
      is_blocked: false,
      is_deactivated: false,
    })
  }

  return next()
}
