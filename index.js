const mongoose = require('mongoose')
const config = require('./config')
const log = require('./utils/log')
const startBot = require('./bot')

mongoose
  .connect(config.get('db'))
  .then(() => startBot())
  .catch((err) => log.error(`Bot initialization error: ${err}`))
