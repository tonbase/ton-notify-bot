require('dotenv')
  .config({ path: __dirname + '/.env' })

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
  bot: {
    token: {
      doc: 'Telegram Bot token.',
      format: String,
      default: '',
      env: 'BOT_TOKEN',
    },
    notifications_channel_id: {
      doc: 'Notifications channel ID.',
      format: String,
      default: '',
      env: 'NOTIFICATIONS_CHANNEL_ID',
    },
  },
  min_transaction_amount: {
    doc: 'Minimum amount of a transaction to send a notification to the channel',
    format: Number,
    default: 1000,
    env: 'MIN_TRANSACTION_AMOUNT',
  },
  ton: {
    node: {
      doc: 'TON Node API URL.',
      format: String,
      default: 'https://testnet.toncenter.com/api/v2/jsonRPC',
      env: 'TON_NODE_URL',
    },
    index: {
      doc: 'TON Index API URL.',
      format: String,
      default: 'https://testnet.toncenter.com/api/index',
      env: 'TON_INDEX_URL',
    },
    node_key: {
      doc: 'TON Node API Key.',
      format: String,
      default: '',
      env: 'TON_NODE_API_KEY',
    },
    index_key: {
      doc: 'TON Index API Key.',
      format: String,
      default: '',
      env: 'TON_INDEX_API_KEY',
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
