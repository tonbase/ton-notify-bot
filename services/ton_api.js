const fetch = require('node-fetch')

class TonApi {
  constructor(net = 'mainnet') {
    this.rootUrl =
      net === 'mainnet'
        ? 'https://toncenter.com/api/v2'
        : 'https://testnet.toncenter.com/api/v2'
  }

  async get(method, searchParams) {
    const url = new URL(`${this.rootUrl}/${method}`)
    Object.entries(searchParams).forEach((el) => url.searchParams.set(...el))

    const response = await fetch(url)
    return response.json()
  }

  async post(method, body) {
    const url = new URL(`${this.rootUrl}/${method}`)

    const response = await fetch(url, {
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return response.json()
  }

  getAddressInformation(address) {
    return this.get('getAddressInformation', { address })
  }
}

module.exports = TonApi
