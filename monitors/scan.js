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
  const masterchainInfo = await ton.node.send('getMasterchainInfo', {});
  log.info(`Enqueue master blocks ${lastEnqueuedMaster.last_checked_block}-${masterchainInfo.last.seqno}`);

  const curSeqno = lastEnqueuedMaster.last_checked_block;
  const lastSeqno = masterchainInfo.last.seqno;
  for (let seqno = curSeqno; seqno < lastSeqno; seqno++) {
    const transactionsList = await ton.getTransactionsByMasterchainSeqno(seqno);
    log.info(`Received ${transactionsList.lenght} transactions on seqno: ${seqno}`);

    for (const index in transactionsList) {
      const transaction = transactionsList[index];
      transaction.address = new ton.utils.Address(transaction.account).toString(true, true, true, false,)

      log.info(`Adding transaction #${+index + 1} to queue (${transaction.address})`);
      // console.log(transaction)
      addTransactionToQueue(transaction);
    }
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