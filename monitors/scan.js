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
    // log.warn('scan is running')
    return false
  }
  IS_RUNNING = true

  const lastEnqueuedMaster = await Counters.findOne().sort({ updated_at: -1 });
  log.info(`Received lastEnqueuedMaster from Counters: ${lastEnqueuedMaster}`);

  let lastSeqno //= lastEnqueuedMaster?.last_checked_block;
  if (!lastEnqueuedMaster || !lastSeqno) {
    log.info('Sending getMasterchainInfo request')
    const masterchainInfo = await ton.node.send('getMasterchainInfo', {});
    log.info(`Received last.seqno: ${masterchainInfo.last.seqno}`)
    lastSeqno = masterchainInfo.last.seqno;
  }

  log.info('Sending getTransactionsByMasterchainSeqno request')

  const transactionsList = await ton.getTransactionsByMasterchainSeqno(lastSeqno);
  log.info(`Received ${transactionsList.lenght} transactions`);

  for (const index in transactionsList) {
    const transaction = transactionsList[index];
    // const transactions = await ton.provider.send('getTransactions', {
    //   address: transaction.address,
    //   lt: transaction.lt,
    //   hash: ton.utils.bytesToHex(ton.utils.base64ToBytes(transaction.hash)),
    //   limit: 1,
    // })
    log.info(`Adding transaction #${+index + 1} to queue`);
    console.log(transaction)
    addTransactionToQueue(transaction);
  }

  await Counters.updateOne({
    last_checked_block: lastSeqno
  });

  IS_RUNNING = false
}

mongoose
  .connect(config.get('db'))
  .then(() =>
    setInterval(
      () =>
        scanAddresses().catch((err) => {
          IS_RUNNING = false
          log.error(`Scan adresses error: ${err}`)
        }),
      config.get('synchronizer.interval') * 1000,
    ),
  )
  .catch((err) => log.error(`Monitor initialization error: ${err}`))
