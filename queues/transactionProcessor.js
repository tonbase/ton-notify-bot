const { Telegram, Extra } = require('telegraf')
const { promisify } = require('util')
const config = require('../config')
const i18n = require('../i18n')
const AddressRepository = require('../repositories/address')
const UserRepository = require('../repositories/user')
const CountersModel = require('../models/counters')
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

  let sendNotifications = 0

  for (const { _id, address, tag, user_id: userId } of addresses) {
    const user = await userRepository.getByTgId(userId)

    if (user.is_blocked || user.is_deactivated) {
      return false
    }

    const from =
      address === transaction.from
        ? { address, tag, user_id: userId }
        : addresses.find((el) => el.address === transaction.from && el.user_id === userId)
    const to =
      address === transaction.to
        ? { address, tag, user_id: userId }
        : addresses.find((el) => el.address === transaction.to && el.user_id === userId)

    const type = i18n.t(
      user.language,
      address === transaction.from ? 'transaction.send' : 'transaction.receive',
    )
    const fromTag = from && from.tag ? from.tag : formatAddress(transaction.from)
    const toTag = to && to.tag ? to.tag : formatAddress(transaction.to)

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

    sendNotifications++

    await addressRepository.incSendCoinsCounter(_id, 1)

    await timeout(200)
  }

  await CountersModel.updateOne(
    {},
    { $inc: { send_notifications: sendNotifications } },
    { upsert: true },
  )

  return true
}
