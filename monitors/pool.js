const axios = require('axios')

const log = require('../utils/log')
const { sleep } = require('../utils/sleep')

const pools = []

const updatePool = async () => {
  try {
    const { data } = await axios.get('https://tonapi.io/v2/staking/pools?include_unverified=true')

    pools.splice(0, pools.length)
    pools.push(data.pools)
  } catch (err) {
    log.error(`Pool scan error: ${err}`)
  }

  await sleep(5 * 60 * 1000)
  updatePool()
}

updatePool()

module.exports = () => pools
