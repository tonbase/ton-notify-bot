const crypto = require('crypto')
const { Telegram, Extra } = require('telegraf')
const Big = require('big.js')
const { promisify } = require('util')
const config = require('../config')
const log = require('../utils/log')
const i18n = require('../i18n')
const ton = require('./ton')
const getPrice = require('../monitors/scanPrice')
const AddressRepository = require('../repositories/address')
const UserRepository = require('../repositories/user')
const CountersModel = require('../models/counters')
const formatAddress = require('../utils/formatAddress')
const formatTransactionValue = require('../utils/formatTransactionValue')
const formatBalance = require('../utils/formatBalance')
const formatTransactionPrice = require('../utils/formatTransactionPrice')
const escapeHTML = require('../utils/escapeHTML')
const knownAccounts = require('../data/addresses.json')

const timeout = promisify(setTimeout)

const telegram = new Telegram(config.get('bot.token'))

const addressRepository = new AddressRepository()
const userRepository = new UserRepository()

const NOTIFICATIONS_CHANNEL_ID = config.get('bot.notifications_channel_id')
const MIN_TRANSACTION_AMOUNT = config.get('min_transaction_amount')

const SENT_RAW_MESSAGES = []

const encodeMd5 = (str) => crypto.createHash('md5').update(str).digest('hex')

module.exports = async (data) => {
  const transaction = data
  const addresses = await addressRepository.getByAddress([transaction.from, transaction.to], {
    is_deleted: false,
    notifications: true,
  })

  let sendNotifications = 0
  const fromBalance = await ton.provider.getBalance(transaction.from).catch(() => {})
  const toBalance = await ton.provider.getBalance(transaction.to).catch(() => {})

  const formattedFromBalance =
    fromBalance || fromBalance === 0 ? formatBalance(ton.utils.fromNano(fromBalance)) : ''
  const formattedToBalance =
    toBalance || toBalance === 0 ? formatBalance(ton.utils.fromNano(toBalance)) : ''
  const formattedTransactionValue = formatTransactionValue(transaction.value)

  const fromDefaultTag = knownAccounts[transaction.from] || formatAddress(transaction.from)
  const toDefaultTag = knownAccounts[transaction.to] || formatAddress(transaction.to)

  const comment = transaction.comment ? escapeHTML(transaction.comment) : ''

  const transactionPrice = getPrice()
    ? formatTransactionPrice(new Big(transaction.value).mul(getPrice()))
    : ''

  for (const { _id, address, tag, user_id: userId } of addresses) {
    try {
      const user = await userRepository.getByTgId(userId)

      if (user.is_blocked || user.is_deactivated) {
        continue
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

      const fromTag = from && from.tag ? from.tag : fromDefaultTag
      const toTag = to && to.tag ? to.tag : toDefaultTag

      const rawMessageText = i18n.t(user.language, 'transaction.message', {
        type,
        from: transaction.from,
        to: transaction.to,
        fromTag,
        toTag,
        fromBalance:
          formattedFromBalance &&
          i18n.t(user.language, 'transaction.accountBalance', { value: formattedFromBalance }),
        toBalance:
          formattedToBalance &&
          i18n.t(user.language, 'transaction.accountBalance', { value: formattedToBalance }),
        value: formattedTransactionValue,
        price:
          transactionPrice &&
          i18n.t(user.language, 'transaction.price', { value: transactionPrice }),
        comment: comment && i18n.t(user.language, 'transaction.comment', { text: comment }),
      })

      if (SENT_RAW_MESSAGES.find(({id, hash}) => id === userId && hash === encodeMd5(rawMessageText))) {
        continue
      }

      SENT_RAW_MESSAGES.push({
        id: userId,
        hash: encodeMd5(rawMessageText),
        sentDate: new Date(),
      })

      await telegram.sendMessage(userId, rawMessageText, Extra.HTML().webPreview(false))

      sendNotifications++

      await addressRepository.incSendCoinsCounter(_id, 1)
    } catch (err) {
      if (err.code === 403) {
        log.error(`Transaction notification sending error: ${err}`)
        addressRepository.updateOneById(_id, { notifications: false }).then(() => {
          log.error(`Disable notification for ${address}`)
        })
      }
    }
    await timeout(200)
  }

  await CountersModel.updateOne(
    {},
    { $inc: { send_notifications: sendNotifications } },
    { upsert: true },
  )

  if (new Big(transaction.value).gte(MIN_TRANSACTION_AMOUNT)) {
    const rawMessageText = i18n.t('en', 'transaction.channelMessage', {
      from: transaction.from,
      to: transaction.to,
      fromTag: fromDefaultTag,
      toTag: toDefaultTag,
      fromBalance:
        formattedFromBalance &&
        i18n.t('en', 'transaction.accountBalance', { value: formattedFromBalance }),
      toBalance:
        formattedToBalance &&
        i18n.t('en', 'transaction.accountBalance', { value: formattedToBalance }),
      value: formattedTransactionValue,
      price: transactionPrice && i18n.t('en', 'transaction.price', { value: transactionPrice }),
      comment: comment && i18n.t('en', 'transaction.comment', { text: comment }),
    })
    if (
      SENT_RAW_MESSAGES
      .find(({id, hash}) => id === +NOTIFICATIONS_CHANNEL_ID && hash === encodeMd5(rawMessageText))
    ) {
      log.info(`block send copy message to ${NOTIFICATIONS_CHANNEL_ID}: ${rawMessageText}`)
      return false
    }
    SENT_RAW_MESSAGES.push({
      id: +NOTIFICATIONS_CHANNEL_ID,
      hash: encodeMd5(rawMessageText),
      sentDate: new Date(),
    })
    await telegram.sendMessage(
      NOTIFICATIONS_CHANNEL_ID,
      rawMessageText,
      Extra.HTML().webPreview(false)
    )
  }

  await timeout(500)

  return true
}
