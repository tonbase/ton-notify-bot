const { Telegraf, Composer, Stage } = require('telegraf')

const i18n = require('./i18n')

const config = require('./config')
const log = require('./utils/log')

const editTagScene = require('./scenes/editTag')
const editMinAmountScene = require('./scenes/editMinAmount')

const sendWelcome = require('./handlers/sendWelcome')
const addAddress = require('./handlers/addAddress')
const sendAddressesList = require('./handlers/sendAddressesList')
const changeListPage = require('./handlers/changeListPage')
const openAddress = require('./handlers/openAddress')
const handleEdit = require('./handlers/handleEdit')
const handleMinAmount = require('./handlers/handleMinAmount')
const openAddressNotifications = require('./handlers/openAddressNotifications')
const turnNotifications = require('./handlers/turnNotifications')
const deleteAddress = require('./handlers/deleteAddress')
const undoAddressDelete = require('./handlers/undoAddressDelete')
const editUndoKeyboard = require('./handlers/editUndoKeyboard')

const session = require('./middlewares/session')
const blockDetection = require('./middlewares/blockDetection')
const auth = require('./middlewares/auth')

const bot = new Telegraf(config.get('bot.token'))

const payloadRegex = /^(\w|-){48}/

const stage = new Stage([editTagScene, editMinAmountScene])

stage.start(
  Composer.optional(
    ({ startPayload }) => startPayload && payloadRegex.test(startPayload),
    Composer.tap(addAddress),
    Stage.leave(),
  ),
)

stage.start(Composer.tap(sendWelcome), Stage.leave())

stage.hears(/(^(\w|-){48}(:.+)*$)/, Composer.tap(addAddress), Stage.leave())

stage.command('list', Composer.tap(sendAddressesList), Stage.leave())

bot.use(session, i18n)

bot.use(blockDetection, auth)

bot.use(stage)

bot.catch((err) => log.error(`Handle update error: ${err}`))

bot.on(
  'callback_query',
  Composer.tap((ctx) => ctx.answerCbQuery()),
)

bot.action(/(?<=^list_)\d+/, changeListPage)

bot.action(/(?<=^open_).+/, openAddress)

bot.action(/(?<=^edit_).+/, handleEdit)

bot.action(/(?<=^notify_min_amout_).+$/, handleMinAmount)

bot.action(/(?<=^notify_)(.+)_(on|off)$/, turnNotifications)

bot.action(/(?<=^notify_).+/, openAddressNotifications)

bot.action(/(?<=^delete_).+/, deleteAddress)

bot.action(/(?<=^undo_).+/, Composer.tap(undoAddressDelete), openAddress)

bot.action(/(?<=^open-list-)(.+)-(\d+)$/, Composer.tap(editUndoKeyboard), sendAddressesList)

module.exports = (options) => bot.launch(options).then(() => log.info('bot was launched'))
