const axios = require('axios')
const Tonweb = require('tonweb')

const config = require('../config')

const {
  HttpProvider,
  utils,
} = Tonweb

class TON {
  constructor(nodeUrl, indexUrl, nodeApiKey, indexApiKey) {
    this.index = axios.create({
      baseURL: indexUrl,
      headers: { 'X-API-Key': indexApiKey },
    })
    this.node = new HttpProvider(nodeUrl, { apiKey: nodeApiKey })
    this.tonweb = new Tonweb(this.node)
    this.utils = utils
  }

  async transactionsByMasterchainBlock(seqno) {
    const response = await this.index.get('/transactionsByMasterchainBlock', {
      params: {
        seqno,
        limit: 1000,
        offset: 0,
        sort: 'desc',
      },
    })

    if (response.status !== 200) {
      throw new Error('transactionsByMasterchainBlock failed')
    }

    return response.data
  }
}

module.exports = new TON(
  config.get('ton.node'),
  config.get('ton.index'),
  config.get('ton.node_key'),
  config.get('ton.index_key'),
)
