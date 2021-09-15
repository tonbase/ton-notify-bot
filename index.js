require('dotenv').config();
const mongoose = require('mongoose');
const startBot = require('./bot');

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => startBot())
  .catch(console.error);
