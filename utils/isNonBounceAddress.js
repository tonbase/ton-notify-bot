const ton = require('../services/ton')

module.exports = (address) => (address ? !new ton.utils.Address(address).isBounceable : false)
