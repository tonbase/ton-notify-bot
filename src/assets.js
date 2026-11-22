const { rawAddress } = require('./address')

// Official TON USDt: https://tether.to/en/supported-protocols/
// Precision: https://tether.to/usdt-ton.json
const USDT_MASTER = rawAddress('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs')
const USDT_DECIMALS = 6

module.exports = { USDT_MASTER, USDT_DECIMALS }
