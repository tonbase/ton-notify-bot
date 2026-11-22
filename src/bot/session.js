const { User, Session } = require('../models')

function restoreSession(data = {}) {
  const session = { ...data }
  const scene = session.__scenes
  const flows = { editTag: 'tag', editMinAmount: 'amount', editExceptions: 'filters' }
  if (!Object.hasOwn(session, 'flow') && flows[scene?.current]
    && (!scene.expires || scene.expires > Date.now() / 1000)) {
    session.flow = flows[scene.current]
    session.addressId = String(scene.state?.address_id || '')
  }
  delete session.__scenes
  return session
}

async function privateSession(ctx, next) {
  if (ctx.myChatMember?.chat?.type === 'private') {
    const blocked = ctx.myChatMember.new_chat_member?.status === 'kicked'
    await User.updateOne({ user_id: ctx.myChatMember.chat.id }, { $set: { is_blocked: blocked } })
    return null
  }
  if (!ctx.from || ctx.chat?.type !== 'private') return null
  ctx.user = await User.findOneAndUpdate({ user_id: ctx.from.id }, {
    $set: {
      first_name: ctx.from.first_name || 'User', last_name: ctx.from.last_name || '',
      language_code: ctx.from.language_code || '', last_activity_at: new Date(),
      is_deactivated: false,
      is_blocked: false,
    },
    $setOnInsert: { user_id: ctx.from.id },
  }, { upsert: true, new: true })
  const key = { user_id: ctx.from.id, chat_id: ctx.chat.id }
  const saved = await Session.findOne(key)
  ctx.session = restoreSession(saved?.data || {})
  await next()
  await Session.updateOne(key, { $set: { data: ctx.session } }, { upsert: true })
}

module.exports = { privateSession, restoreSession }
