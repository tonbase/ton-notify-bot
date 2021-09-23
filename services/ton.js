const Tonweb = require('tonweb')

const config = require('../config')

const { HttpProvider, utils } = Tonweb

class TON {
  constructor(providerUrl) {
    this.provider = new HttpProvider(providerUrl)
    this.tonweb = new Tonweb(this.provider)
    this.utils = utils
  }

  async getAddress(wallet, bounceable = true) {
    const address = await wallet.getAddress()
    return address.toString(true, true, bounceable, false)
  }
}

module.exports = new TON(config.get('ton.provider'))
