const path = require('node:path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

function integer(name, fallback, min = 0) {
  const value = process.env[name] === undefined || process.env[name] === ''
    ? fallback : Number(process.env[name])
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`)
  }
  return value
}

const config = {
  botToken: process.env.BOT_TOKEN || '',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ton-notify-dev',
  indexUrl: (process.env.TON_INDEX_URL || 'https://toncenter.com/api/v3').replace(/\/$/, ''),
  indexKey: process.env.TON_INDEX_API_KEY || '',
  channelId: process.env.NOTIFICATIONS_CHANNEL_ID || '',
  minChannelTon: process.env.MIN_TRANSACTION_AMOUNT || '50000',
  scanIntervalMs: integer('SCAN_INTERVAL_MS', 5000, 1000),
  lagBlocks: integer('SCAN_LAG_BLOCKS', 16),
  replayBlocks: integer('SCAN_REPLAY_BLOCKS', 120),
  startSeqno: process.env.SCAN_START_SEQNO ? integer('SCAN_START_SEQNO', 0) : null,
  pageSize: integer('SCAN_PAGE_SIZE', 500, 1),
  httpTimeoutMs: integer('HTTP_TIMEOUT_MS', 15000, 1000),
  requestsPerSecond: integer('TON_REQUESTS_PER_SECOND', 80, 1),
  httpConcurrency: integer('TON_HTTP_CONCURRENCY', 8, 1),
  blockConcurrency: integer('SCAN_BLOCK_CONCURRENCY', 4, 1),
  sendNotifications: process.env.SEND_NOTIFICATIONS === 'true',
}

if (config.pageSize > 1000) throw new Error('SCAN_PAGE_SIZE must be <= 1000')
if (config.blockConcurrency > 16) throw new Error('SCAN_BLOCK_CONCURRENCY must be <= 16')

function requireBotToken() {
  if (!config.botToken) throw new Error('BOT_TOKEN is missing; set it in the ignored .env file')
}

module.exports = { config, requireBotToken }
