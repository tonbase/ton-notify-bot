/* eslint-disable no-continue */
/* eslint-disable no-await-in-loop */
const { Telegram, Extra } = require('telegraf')
const LRUCache = require('lru-cache')
const { promisify } = require('util')
const { Big } = require('../utils/big')
const config = require('../config')
const log = require('../utils/log')
const i18n = require('../i18n')
const ton = require('./ton')
const getPrice = require('../monitors/scanPrice')
const AddressRepository = require('../repositories/address')
const UserRepository = require('../repositories/user')
const formatAddress = require('../utils/formatAddress')
const formatTransactionValue = require('../utils/formatTransactionValue')
const formatBalance = require('../utils/formatBalance')
const formatTransactionPrice = require('../utils/formatTransactionPrice')
const escapeHTML = require('../utils/escapeHTML')
const getTitleByAddress = require('../monitors/addresses')
const excludedAddresses = require('../data/excludedAddresses.json')

const timeout = promisify(setTimeout)

const telegram = new Telegram(config.get('bot.token'))

const addressRepository = new AddressRepository()
const userRepository = new UserRepository()

const NOTIFICATIONS_CHANNEL_ID = config.get('bot.notifications_channel_id')
const MIN_TRANSACTION_AMOUNT = config.get('min_transaction_amount')

const cache = new LRUCache({
  ttl: 30 * 60 * 1000, // 30 minutes
  max: 1000,
})

async function getBalance(address, seqno) {
  const cacheBalanceKey = `${address}:${seqno}`

  const cachedBalance = cache.get(cacheBalanceKey)
  if (cachedBalance) {
    return cachedBalance
  }

  const balance = await ton.node.getBalance(address)
  cache.set(cachedBalance, balance)
  return balance
}

async function sendTransactionMessage(addresses, transaction, transactionSeqno) {
  const fromBalance = await getBalance(transaction.from, transactionSeqno)
  const toBalance = await getBalance(transaction.to, transactionSeqno)

  const formattedFromBalance =
    fromBalance || fromBalance === 0 ? formatBalance(ton.utils.fromNano(fromBalance)) : ''
  const formattedToBalance =
    toBalance || toBalance === 0 ? formatBalance(ton.utils.fromNano(toBalance)) : ''

  const formattedTransactionValue = formatTransactionValue(transaction.value)

  const comment = transaction.comment ? escapeHTML(transaction.comment) : ''

  const transactionPrice = getPrice()
    ? formatTransactionPrice(new Big(transaction.value).mul(getPrice()))
    : ''

  // eslint-disable-next-line no-restricted-syntax, object-curly-newline
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

      const fromTag = from && from.tag ? from.tag : transaction.fromDefaultTag
      const toTag = to && to.tag ? to.tag : transaction.toDefaultTag

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

      await telegram.sendMessage(userId, rawMessageText, Extra.HTML().webPreview(false))

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

  if (transaction.sendToChannel) {
    const rawMessageText = i18n.t('en', 'transaction.channelMessage', {
      from: transaction.from,
      to: transaction.to,
      fromTag: transaction.fromDefaultTag,
      toTag: transaction.toDefaultTag,
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

    await telegram.sendMessage(
      NOTIFICATIONS_CHANNEL_ID,
      rawMessageText,
      Extra.HTML().webPreview(false),
    ).catch((err) => {
      log.error(`Transaction notification sending error: ${err}`)
    })
  }
}

module.exports = async (data, meta) => {
  const transaction = data
  const transactionHash = meta.hash
  const transactionSeqno = meta.seqno

  transaction.fromDefaultTag = getTitleByAddress(transaction.from) ||
    formatAddress(transaction.from)
  transaction.toDefaultTag = getTitleByAddress(transaction.to) || formatAddress(transaction.to)

  if (excludedAddresses.includes(transaction.from) || excludedAddresses.includes(transaction.to)) {
    log.info(`Ignored ${excludedAddresses.includes(transaction.from) ? transaction.fromDefaultTag : transaction.toDefaultTag}`)
    return false
  }

  if (cache.get(transactionHash) !== undefined) {
    return false
  }
  cache.set(transactionHash, data)

  const addresses = await addressRepository.getByAddress([transaction.from, transaction.to], {
    is_deleted: false,
    'notifications.is_enabled': true,
    $expr: { $gte: [transaction.nanoValue, '$notifications.min_amount'] },
  })

  const filteredAddresses = addresses.filter((v) => {
    const { exceptions, inclusion } = v.notifications

    if (exceptions.includes(transaction.comment)) {
      return false
    }

    if (inclusion.length) {
      return inclusion.includes(transaction.comment)
    }

    return true
  })

  transaction.sendToChannel = (new Big(transaction.value).gte(MIN_TRANSACTION_AMOUNT))

  if (filteredAddresses.length || transaction.sendToChannel) {
    log.info(`Sending notify to users(${filteredAddresses.length}) or to channel(${transaction.sendToChannel ? '+' : '-'})`)
    await sendTransactionMessage(filteredAddresses, transaction, transactionSeqno)
  }

  await timeout(500)

  return true
}
