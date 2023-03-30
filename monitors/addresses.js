const axios = require('axios')

const log = require('../utils/log')
const { sleep } = require('../utils/sleep')

const knownAccounts = {}

const updateAddresses = async () => {
  try {
    const { data } = await axios.get('https://catchain.github.io/tonscan/src/addrbook.json')

    const list = {};
    for (const adr in data) {
      const address = data[adr]
      const title = (typeof address === 'string') ? address :
        (address?.name ? `${address.tonIcon ? `${address.tonIcon} ` : ''}${address.name}` : null)

      if (!title) {
        continue;
      }

      knownAccounts[adr] = title
    }
  } catch (err) {
    log.error(`Price scan error: ${err}`)
  }

  await sleep(60 * 60 * 1000) // 1 hour
  updateAddresses()
}

updateAddresses()

function getTitleByAddress(address) {
  return knownAccounts[address] || false
}

module.exports = getTitleByAddress
