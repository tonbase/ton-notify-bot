const { Telegraf, Composer, session, Stage } = require('telegraf')
const TelegrafI18n = require('telegraf-i18n')
const path = require('path')

const config = require('./config')
const log = require('./utils/log')

const editTagScene = require('./scenes/editTag')

const sendWelcome = require('./handlers/sendWelcome')
const addAddress = require('./handlers/addAddress')
const sendAddressesList = require('./handlers/sendAddressesList')
const changeListPage = require('./handlers/changeListPage')
const openAddress = require('./handlers/openAddress')
const handleEdit = require('./handlers/handleEdit')
const turnNotifications = require('./handlers/turnNotifications')

const payloadRegex = /^(\w|-){48}/

const i18n = new TelegrafI18n({
  defaultLanguage: 'en',
  directory: path.resolve(__dirname, 'locales'),
})

const stage = new Stage([editTagScene])

stage.start(
  Composer.optional(
    ({ startPayload }) => startPayload && payloadRegex.test(startPayload),
    Composer.tap(addAddress),
    Stage.leave(),
  ),
)

stage.start(Composer.tap(sendWelcome), Stage.leave())

stage.hears(/^(\w|-){48}:.+/, Composer.tap(addAddress), Stage.leave())

stage.command('list', Composer.tap(sendAddressesList), Stage.leave())

const bot = new Telegraf(config.get('bot.token'))

bot.use(session(), i18n, stage)

bot.catch(console.error)

bot.on(
  'callback_query',
  Composer.tap((ctx) => ctx.answerCbQuery()),
)

bot.action(/(?<=^list_)\d+/, changeListPage)

bot.action(/(?<=^open_).+/, openAddress)

bot.action(/(?<=^edit_).+/, handleEdit)

bot.action(/(?<=^notify_).+_(on|off)$/, turnNotifications)

module.exports = (options) =>
  bot.launch(options).then(() => log.info('bot was launched'))
