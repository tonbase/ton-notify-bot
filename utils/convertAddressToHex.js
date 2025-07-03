const ton = require('../services/ton')

module.exports = (address) => new ton.utils.Address(address).toString(false, false, false, false).toUpperCase()
