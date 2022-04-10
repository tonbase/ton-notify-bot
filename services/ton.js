const Tonweb = require('tonweb')

const config = require('../config')

const {
  HttpProvider,
  utils
} = Tonweb

class TON {
  constructor(providerUrl, apiKey) {
    this.provider = new HttpProvider(providerUrl, { apiKey })
    this.tonweb = new Tonweb(this.provider)
    this.utils = utils
  }
}

module.exports = new TON(config.get('ton.provider'), config.get('ton.key'))
