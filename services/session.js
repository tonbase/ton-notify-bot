const Sessions = require('../models/sessions')

class MongoSession {
  constructor(options) {
    this.options = {
      property: 'session',
      getSessionKey: (ctx) => ctx.from && ctx.chat && {user_id: ctx.from.id, chat_id: ctx.chat.id},
      store: {},
      ...options,
    }
  }

  getSessionKey(...v) {
    return this.options.getSessionKey(...v)
  }

  // eslint-disable-next-line class-methods-use-this
  saveSession(key, session) {
    if (!session || Object.keys(session).length === 0) {
      return this.clearSession(key)
    }
    return Sessions.updateOne(key, {$set: {data: session}}, {upsert: true})
  }

  // eslint-disable-next-line class-methods-use-this
  clearSession(key) {
    return Sessions.deleteOne(key)
  }

  // eslint-disable-next-line class-methods-use-this
  async getSession(key) {
    const session = await Sessions.findOne(key)
    if (!session) {
      return {}
    }
    return session.data
  }

  middleware() {
    return async (ctx, next) => {
      if (!ctx.chat || ctx.chat.type !== 'private') {
        return next()
      }
      const key = this.getSessionKey(ctx)
      if (!key) {
        return next()
      }
      let session = await this.getSession(key)
      Object.defineProperty(ctx, this.options.property, {
        get() { return session },
        set(newValue) { session = {...newValue} }
      })
      return next().then(() => this.saveSession(key, session))
    }
  }
}

module.exports = MongoSession
