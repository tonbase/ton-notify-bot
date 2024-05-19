const ton = require('../services/ton')

module.exports = (address) => new ton.utils.Address(address).toString(true, true, false, false)
