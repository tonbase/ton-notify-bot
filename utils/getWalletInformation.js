const ton = require('../services/ton')

module.exports = (address) => ton.node.send('getWalletInformation', { address })
