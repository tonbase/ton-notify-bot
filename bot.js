const { Telegraf, Composer, session } = require('telegraf')
const TelegrafI18n = require('telegraf-i18n')
const path = require('path')

const config = require('./config')
const log = require('./utils/log')

const sendWelcome = require('./handlers/send_welcome')
const addAddress = require('./handlers/add_address')
const sendAddressesList = require('./handlers/send_addresses_list')
const changeListPage = require('./handlers/change_list_page')
const openAddress = require('./handlers/open_address')
const handleEdit = require('./handlers/handle_edit')
const editTag = require('./handlers/edit_tag')

const payloadRegex = /^(\w|-){48}/

const i18n = new TelegrafI18n({
  defaultLanguage: 'en',
  directory: path.resolve(__dirname, 'locales'),
})

const bot = new Telegraf(config.get('bot.token'))

bot.use(session())

bot.catch(console.error)

bot.on(
  'callback_query',
  Composer.tap((ctx) => ctx.answerCbQuery()),
)

bot.use(i18n)

bot.use(
  Composer.tap((ctx) => {
    if (!ctx.session.address_id_for_edit) {
      return
    }

    const text = ctx.message && ctx.message.text
    if (
      text &&
      text !== '/list' &&
      text !== '/start' &&
      !payloadRegex.test(text)
    ) {
      return
    }

    delete ctx.session.address_id_for_edit
  }),
)

bot.start(
  Composer.optional(
    ({ startPayload }) => startPayload && payloadRegex.test(startPayload),
    addAddress,
  ),
)

bot.start(sendWelcome)

bot.command('list', sendAddressesList)

bot.action(/(?<=^list_)\d+/, changeListPage)

bot.action(/(?<=^open_).+/, openAddress)

bot.action(/(?<=^edit_).+/, handleEdit)

bot.hears(/^(\w|-){48}:.+/, addAddress)

bot.on(
  'text',
  Composer.optional((ctx) => ctx.session.address_id_for_edit, editTag),
)

module.exports = (options) =>
  bot.launch(options).then(() => log.info('bot was launched'))
