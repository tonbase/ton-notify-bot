f = (...args) => console.log(...args)
j = (obj) => f(JSON.stringify(obj, null, 2))

const Big = require('big.js')
const mongoose = require('mongoose')

const config = require('../config')
const ton = require('../services/ton')
const log = require('../utils/log')
const Counters = require('../models/counters')
const transactionProcessor = require('../services/transactionProcessor')

let IS_RUNNING = false

const addTransactionToQueue = (transaction) => {
  const inMsg = transaction?.in_msg
  const outMsg = transaction?.out_msgs?.[0]
  const message = inMsg?.source && inMsg?.destination ? inMsg : outMsg

  if (!message || !new Big(message?.value).gt(0)) {
    return false
  }

  const comment = message?.msg_data?.text
  const isDataText = message?.msg_data?.['@type'] === 'msg.dataText'

  return transactionProcessor({
    from: message.source,
    to: message.destination,
    value: ton.utils.fromNano(message.value.toString()),
    comment: comment && isDataText
      ? new TextDecoder().decode(ton.utils.base64ToBytes(comment))
      : '',
  })
}

const scanAddresses = async () => {
  if (IS_RUNNING) {
    log.warn('Scan is running')
    return false
  }
  IS_RUNNING = true

  const lastCheckedBlockFilter = { name: 'lastCheckedBlock' }

  const lastEnqueuedMaster = await Counters.findOne(lastCheckedBlockFilter)
  const masterchainInfo = await ton.node.send('getMasterchainInfo', {})
  const lastSeqno = masterchainInfo.last.seqno

  let currentSeqno = lastEnqueuedMaster?.data?.seqno

  if (!currentSeqno || currentSeqno === 0) {
    await Counters.findOneAndUpdate(
      lastCheckedBlockFilter,
      { data: { seqno: lastSeqno } },
      { upsert: true },
    )
    currentSeqno = lastSeqno
  }

  currentSeqno += 1 // to skip check one block twice

  log.info(`Enqueue master blocks ${currentSeqno}-${lastSeqno}`)

  const excludedTransactionTypes = ['trans_tick_tock']
  const excludedAccounts = [
    'Ef8zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0vF',
  ]

  for (let seqno = currentSeqno; seqno < lastSeqno; seqno++) {
    const transactionsList = await ton.getTransactionsByMasterchainSeqno(seqno)
    const filteredTransactionsList = transactionsList
      .filter((t) => !excludedTransactionTypes
          .includes(t.transaction_type) &&
        !excludedAccounts
          .includes(new ton.utils.Address(t.account).toString(true, true, true, false))
      )
    log.info(`Received ${filteredTransactionsList.length} transactions on seqno: ${seqno}`)
    for (const [index, transaction] of filteredTransactionsList.entries()) {
      transaction.address = new ton.utils.Address(transaction.account)
        .toString(true, true, true, false)

      log.info(`Adding transaction #${Number(index) + 1} ${transaction
        .transaction_type} to queue (${transaction.address})`)
      // console.log(transaction)
      addTransactionToQueue(transaction)
    }

    await Counters.findOneAndUpdate(lastCheckedBlockFilter, { data: { seqno } })
  }

  IS_RUNNING = false
}

mongoose
  .connect(config.get('db'))
  .then(() =>
    setInterval(
      () =>
        scanAddresses().catch((err) => {
          IS_RUNNING = false
          console.error(err)
          log.error(`Scan adresses error: ${err}`)
        }),
      config.get('synchronizer.interval') * 1000,
    ),
  )
  .catch((err) => log.error(`Monitor initialization error: ${err}`))
