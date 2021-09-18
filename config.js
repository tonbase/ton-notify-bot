require('dotenv').config()

const convict = require('convict')

const config = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development'],
    default: 'development',
    env: 'NODE_ENV',
  },
  db: {
    doc: 'Mongo connection url.',
    format: String,
    default: 'mongodb://localhost:27017/ton-notify',
    env: 'MONGODB_URI',
  },
  redis: {
    doc: 'Redis connection url.',
    format: String,
    default: 'redis://127.0.0.1:6379',
    env: 'REDIS_URI',
  },
  bot: {
    token: {
      doc: 'Telegram Bot token.',
      format: String,
      default: '',
      env: 'BOT_TOKEN',
    },
  },
  ton: {
    provider: {
      doc: 'TON API url.',
      format: String,
      default: 'https://toncenter.com/api/test/v2/jsonRPC',
      env: 'TON_PROVIDER',
    },
  },
  synchronizer: {
    interval: {
      doc: 'Sync interval in seconds (expected block generation time).',
      format: Number,
      default: 5,
      env: 'SYNCHRONIZER_INTERVAL',
    },
  },
})

config.validate({ allowed: 'strict' })

module.exports = config
