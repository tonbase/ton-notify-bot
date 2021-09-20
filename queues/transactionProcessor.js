const { Telegram, Extra } = require('telegraf')
const Big = require('big.js')
const { promisify } = require('util')
const config = require('../config')
const i18n = require('../i18n')
const ton = require('../services/ton')
const AddressRepository = require('../repositories/address')
const UserRepository = require('../repositories/user')
const CountersModel = require('../models/counters')
const formatAddress = require('../utils/formatAddress')
const formatBigNumberStr = require('../utils/formatBigNumberStr')
const formatBalance = require('../utils/formatBalance')

const timeout = promisify(setTimeout)

const telegram = new Telegram(config.get('bot.token'))

const addressRepository = new AddressRepository()
const userRepository = new UserRepository()

const NOTIFICATIONS_CHANNEL_ID = config.get('bot.notifications_channel')

module.exports = async (job) => {
  const transaction = job.data
  const addresses = await addressRepository.getByAddress([transaction.from, transaction.to], {
    is_deleted: false,
    notifications: true,
  })

  let sendNotifications = 0
  const fromBalance = await ton.provider.getBalance(transaction.from)
  const toBalance = await ton.provider.getBalance(transaction.to)

  const formattedFromBalance = formatBalance(new Big(fromBalance).div(1000000000))
  const formattedToBalance = formatBalance(new Big(toBalance).div(1000000000))
  const formattedTransactionValue = formatBigNumberStr(transaction.value)

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
        fromBalance: formattedFromBalance,
        toBalance: formattedToBalance,
        value: formattedTransactionValue,
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

  if (new Big(transaction.value).gte(1000)) {
    await telegram.sendMessage(
      NOTIFICATIONS_CHANNEL_ID,
      i18n.t('en', 'transaction.channelMessage', {
        from: transaction.from,
        to: transaction.to,
        fromBalance: formattedFromBalance,
        toBalance: formattedToBalance,
        value: formattedTransactionValue,
        comment: transaction.comment
          ? i18n.t('en', 'transaction.comment', { text: transaction.comment })
          : '',
        formatAddress,
      }),
      Extra.HTML().webPreview(false),
    )
  }

  await timeout(200)

  return true
}
