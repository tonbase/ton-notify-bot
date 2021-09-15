const { Telegraf, Composer } = require('telegraf')
const TelegrafI18n = require('telegraf-i18n')
const path = require('path')

const config = require('./config')
const log = require('./utils/log')

const sendWelcome = require('./handlers/send_welcome')
const addAddress = require('./handlers/add_address')
const sendAddressesList = require('./handlers/send_addresses_list')
const changeListPage = require('./handlers/change_list_page')
const openAddress = require('./handlers/open_address')

const i18n = new TelegrafI18n({
  defaultLanguage: 'en',
  directory: path.resolve(__dirname, 'locales'),
})

const bot = new Telegraf(config.get('bot.token'))

bot.catch(console.error)

bot.on(
  'callback_query',
  Composer.tap((ctx) => ctx.answerCbQuery()),
)

bot.use(i18n)

bot.start(sendWelcome)

bot.command('list', sendAddressesList)

bot.action(/(?<=^list_)\d+/, changeListPage)

bot.action(/(?<=^open_).+/, openAddress)

bot.hears(/^(\w|-){48}:.+/, addAddress)

module.exports = (options) =>
  bot.launch(options).then(() => log.info('bot was launched'))
