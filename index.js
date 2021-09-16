const config = require('./config')
const mongoose = require('mongoose');
const startBot = require('./bot');

mongoose
  .connect(config.get('db'))
  .then(() => startBot())
  .catch(console.error);
