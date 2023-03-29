const axios = require('axios')

const log = require('../utils/log')
const { sleep } = require('../utils/sleep')

let price = 0

const scanPrice = async () => {
  try {
    const { data: { data: [{ last }] } } = await axios
      .get('https://www.okx.com/api/v5/market/ticker?instId=TON-USDT-SWAP')
    price = last
  } catch (err) {
    log.error(`Price scan error: ${err}`)
  }

  await sleep(60 * 1000)
  scanPrice()
}

scanPrice()

module.exports = () => price
