const getTitleByAddress = require('../monitors/addresses')
const formatAddress = require('./formatAddress')

module.exports = (address) => getTitleByAddress(address) || formatAddress(address)
