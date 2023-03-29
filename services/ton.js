const axios = require('axios')
const Tonweb = require('tonweb')

const config = require('../config')

const {
  HttpProvider,
  utils,
} = Tonweb

class TON {
  constructor(nodeUrl, indexUrl, apiKey) {
    this.index = axios.create({
      baseURL: indexUrl,
      headers: { 'X-API-Key': apiKey },
    })
    this.node = new HttpProvider(nodeUrl, { apiKey })
    this.tonweb = new Tonweb(this.node)
    this.utils = utils
  }

  async getTransactionsByMasterchainSeqno(seqno) {
    const response = await this.index.get('/getTransactionsByMasterchainSeqno', {
      params: {
        seqno,
        include_msg_body: false,
      },
    })

    if (response.status !== 200) {
      throw new Error('getTransactionsByMasterchainSeqno failed')
    }

    return response.data
  }
}

module.exports = new TON(config.get('ton.node'), config.get('ton.index'), config.get('ton.key'))
