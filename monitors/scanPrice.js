const { promisify } = require('util')

const CoinGecko = require('coingecko-api')
const log = require('../utils/log')

const CoinGeckoClient = new CoinGecko()

const timeout = promisify(setTimeout)

let price = 0

const scanPrice = async () => {
  try {
    const { success, data } = await CoinGeckoClient.simple.price({
      ids: 'the-open-network',
      vs_currencies: ['usd'],
    })

    if (success) {
      price = data['the-open-network'].usd
    }
  } catch (err) {
    log.error(`Price scan error: ${err}`)
  }

  await timeout(60 * 1000)
  scanPrice()
}

scanPrice()

module.exports = () => price
