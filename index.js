const mongoose = require('mongoose')
const transactionQueue = require('./queues/transaction')
const config = require('./config')
const log = require('./utils/log')
const startBot = require('./bot')
const transactionProcessor = require('./queues/transactionProcessor')

transactionQueue.on('failed', (job, err) => log.error(`Transaction processing error: ${err}`))

mongoose
  .connect(config.get('db'))
  .then(() => startBot())
  .then(() => transactionQueue.process(transactionProcessor))
  .catch((err) => log.error(`Bot initialization error: ${err}`))
