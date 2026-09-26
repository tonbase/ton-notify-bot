const { config } = require('./config')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Reservations happen before awaiting so concurrent callers share the limit.
class RequestLimiter {
  constructor(rps, concurrency, { now = Date.now, wait = sleep } = {}) {
    this.spacing = Math.ceil(1000 / rps)
    this.concurrency = concurrency
    this.now = now
    this.wait = wait
    this.next = 0
    this.active = 0
    this.queue = []
  }

  async run(request) {
    if (this.active >= this.concurrency) await new Promise((resolve) => this.queue.push(resolve))
    else this.active += 1
    try {
      const at = Math.max(this.next, this.now())
      this.next = at + this.spacing
      if (at > this.now()) await this.wait(at - this.now())
      return await request()
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.active -= 1
    }
  }
}

function retryDelay(header, attempt) {
  const seconds = Number(header)
  const date = Date.parse(header)
  const requested = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000
    : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
  return Math.max(requested, Math.min(500 * 2 ** attempt, 8000))
}

class TonCenter {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.indexUrl
    this.apiKey = options.apiKey === undefined ? config.indexKey : options.apiKey
    this.timeoutMs = options.timeoutMs || config.httpTimeoutMs
    this.fetch = options.fetch || fetch
    this.wait = options.wait || sleep
    this.attempts = options.attempts || 5
    this.limiter = options.limiter || new RequestLimiter(this.apiKey
      ? options.requestsPerSecond || config.requestsPerSecond : 0.8,
    options.concurrency || config.httpConcurrency)
  }

  async get(path, params = {}) {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null) url.searchParams.append(key, String(item))
      }
    }
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      let delay = retryDelay(null, attempt)
      try {
        return await this.limiter.run(async () => {
          const response = await this.fetch(url, {
            headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
            signal: AbortSignal.timeout(this.timeoutMs),
          })
          // Consume the body on every attempt to release the connection.
          const body = await response.text()
          delay = retryDelay(response.headers.get('retry-after'), attempt)
          let data
          try { data = JSON.parse(body) } catch { /* handled below */ }
          const rateLimited = response.status === 429 || /rate\s*limit|ratelimit/i.test(
            typeof data === 'string' ? data : String(data?.error || data?.result || (!data ? body : '')))
          const failed = !response.ok || rateLimited || !data || data.ok === false || data.error
          if (failed) {
            // Remote bodies can echo credentials or request URLs.
            const error = new Error(`TON Center ${rateLimited ? 'rate limited' : `HTTP ${response.status} / invalid response`} for ${path}`)
            error.retryable = rateLimited || response.status >= 500 || response.status === 408 || (response.ok && !data)
            throw error
          }
          return data
        })
      } catch (error) {
        const retryable = error.retryable || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name)
        if (!retryable || attempt === this.attempts - 1) throw error
        await this.wait(delay)
      }
    }
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
    if (!Array.isArray(data?.transactions)) throw new Error('Invalid transactions response')
    return data
  }
}

module.exports = { TonCenter, RequestLimiter, retryDelay, sleep }
