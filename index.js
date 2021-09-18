const mongoose = require('mongoose')
const transactionQueue = require('./queues/transaction')
const config = require('./config')
const startBot = require('./bot')
const transactionProcessor = require('./queues/transactionProcessor')

transactionQueue.on('failed', (job, err) => console.error(err))

mongoose
  .connect(config.get('db'))
  .then(() => startBot())
  .then(() => transactionQueue.process(transactionProcessor))
  .catch(console.error)
