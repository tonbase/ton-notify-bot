const mongoose = require('mongoose')
const config = require('./config')
const startBot = require('./bot')

mongoose
  .connect(config.get('db'))
  .then(() => startBot())
  .catch(console.error)
