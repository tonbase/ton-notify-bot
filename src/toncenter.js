const { config } = require('./config')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class TonCenter {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.indexUrl
    this.apiKey = options.apiKey === undefined ? config.indexKey : options.apiKey
    this.timeoutMs = options.timeoutMs || config.httpTimeoutMs
    this.nextUnkeyedRequest = 0
  }

  async get(path, params = {}) {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) url.searchParams.append(key, String(item))
      }
    }
    let lastError
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (!this.apiKey) {
        const wait = Math.max(0, this.nextUnkeyedRequest - Date.now())
        if (wait) await sleep(wait)
        this.nextUnkeyedRequest = Date.now() + 1250
      }
      try {
        const response = await fetch(url, {
          headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after'))
          lastError = new Error(`TON Center HTTP ${response.status} for ${path}`)
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30000) : Math.min(1000 * (2 ** attempt), 15000))
          continue
        }
        if (!response.ok) throw new Error(`TON Center HTTP ${response.status} for ${path}`)
        const data = await response.json()
        if (data && (data.ok === false || data.error)) {
          throw new Error(`TON Center error for ${path}: ${String(data.error || data.result).slice(0, 200)}`)
        }
        return data
      } catch (error) {
        lastError = error
        if (attempt < 4 && (error.name === 'TimeoutError' || error.name === 'TypeError')) {
          await sleep(Math.min(1000 * (2 ** attempt), 15000))
          continue
        }
        throw error
      }
    }
    throw lastError
  }

  async masterchainInfo() {
    const data = await this.get('/masterchainInfo')
    if (!Number.isSafeInteger(data?.last?.seqno)) throw new Error('Invalid masterchainInfo response')
    return data
  }

  async actions(params) {
    const data = await this.get('/actions', params)
    if (!Array.isArray(data?.actions)) throw new Error('Invalid actions response')
    return data
  }

  async transactionsByMasterchainBlock(params) {
    const data = await this.get('/transactionsByMasterchainBlock', params)
    if (!Array.isArray(data?.transactions)) throw new Error('Invalid transactionsByMasterchainBlock response')
    return data
  }
}

module.exports = { TonCenter, sleep }
