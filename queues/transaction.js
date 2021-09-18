const Queue = require('bull')
const config = require('../config')

module.exports = new Queue('transactions', config.get('redis'))
