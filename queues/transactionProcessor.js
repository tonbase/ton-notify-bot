const { Telegram, Extra } = require('telegraf')
const { promisify } = require('util')
const config = require('../config')
const i18n = require('../i18n')
const AddressRepository = require('../repositories/address')
const UserRepository = require('../repositories/user')
const formatAddress = require('../utils/formatAddress')

const timeout = promisify(setTimeout)

const telegram = new Telegram(config.get('bot.token'))

const addressRepository = new AddressRepository()
const userRepository = new UserRepository()

module.exports = async (job) => {
  const transaction = job.data
  const addresses = await addressRepository.getByAddress([transaction.from, transaction.to], {
    is_deleted: false,
    notifications: true,
  })

  for (const { address, tag, user_id: userId } of addresses) {
    const user = await userRepository.getByTgId(userId)

    if (user.is_blocked || user.is_deactivated) {
      return false
    }

    const type = i18n.t(
      user.language,
      address === transaction.from ? 'transaction.send' : 'transaction.receive',
    )
    const fromTag = address === transaction.from && tag ? tag : formatAddress(transaction.from)
    const toTag = address === transaction.to && tag ? tag : formatAddress(transaction.to)

    await telegram.sendMessage(
      userId,
      i18n.t(user.language, 'transaction.message', {
        type,
        from: transaction.from,
        to: transaction.to,
        fromTag,
        toTag,
        value: transaction.value,
        comment: transaction.comment
          ? i18n.t(user.language, 'transaction.comment', { text: transaction.comment })
          : '',
      }),
      Extra.HTML().webPreview(false),
    )

    await timeout(200)
  }

  return true
}
