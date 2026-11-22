const { Bot } = require('grammy')
const { config, requireBotToken } = require('./config')
const { mongoose } = require('./models')
const { safeError, shutdownSignal, connectDatabase } = require('./runtime')
const { parseAddressInput, parseWordFilters } = require('./bot/input')
const { privateSession, restoreSession } = require('./bot/session')
const { registerInlineQueries, registerHandlers } = require('./bot/handlers')

function createBot(token = config.botToken, botInfo, options = {}) {
  if (!token) throw new Error('BOT_TOKEN is missing')
  const bot = new Bot(token, botInfo ? { botInfo } : undefined)
  registerInlineQueries(bot, options)
  bot.use(privateSession)
  registerHandlers(bot, options)
  // Exit on unhandled update failures so polling never silently acknowledges
  // an update whose database write failed. The supervisor restarts the bot.
  bot.catch(({ error }) => {
    // A deleted message or blocked chat cannot recover by replaying the update.
    if ([400, 403].includes(error.error_code)) { console.error(`Telegram rejected update reply: ${safeError(error)}`); return }
    throw error
  })
  return bot
}

async function main() {
  requireBotToken()
  const signal = shutdownSignal()
  if (!await connectDatabase(signal, 'bot')) return
  const bot = createBot()
  console.log('Bot connected to MongoDB; starting grammY polling')
  signal.addEventListener('abort', () => { if (bot.isRunning()) void bot.stop().catch(() => {}) })
  try { if (!signal.aborted) await bot.start() }
  finally { await mongoose.disconnect() }
}

if (require.main === module) main().catch((error) => { console.error(safeError(error)); process.exit(1) })

module.exports = { createBot, parseAddressInput, parseWordFilters, restoreSession }
