const { scaledInteger } = require('./amount')

const REFRESH_MS = 60_000
const MAX_AGE_MS = 5 * 60_000
const TICKER_URL = 'https://www.okx.com/api/v5/market/ticker?instId=GRAM-USDT'

// OKX migrated TON to GRAM in June 2026; the old TON instruments no longer exist.
// GRAM/USDT is an approximate USD value, as in the legacy price monitor.
class TonUsdPrice {
  constructor({ fetch: fetchPrice = fetch, now = Date.now, timeoutMs = 3000 } = {}) {
    this.fetch = fetchPrice
    this.now = now
    this.timeoutMs = timeoutMs
    this.quote = null
    this.nextRefreshAt = 0
    this.pending = null
  }

  current() {
    return this.quote && this.now() - this.quote.quotedAt < MAX_AGE_MS ? this.quote.price : null
  }

  async refresh() {
    if (this.pending) return this.pending
    if (this.now() < this.nextRefreshAt && this.current()) return this.quote
    this.pending = this.fetchQuote()
    try { return await this.pending }
    finally { this.pending = null }
  }

  async fetchQuote() {
    const response = await this.fetch(TICKER_URL, { signal: AbortSignal.timeout(this.timeoutMs) })
    if (!response.ok) throw new Error(`OKX price HTTP ${response.status}`)
    const body = await response.json()
    const ticker = body?.data?.[0]
    const price = ticker?.last
    const quotedAt = Number(ticker?.ts)
    const now = this.now()
    // Reject error bodies, wrong markets and stale or invalid quotes before
    // they can enter an amount calculation. Keep the last good quote on error.
    if (body?.code !== '0' || ticker?.instId !== 'GRAM-USDT'
      || typeof price !== 'string' || !/^\d{1,12}(?:\.\d{1,12})?$/.test(price)
      || BigInt(scaledInteger(price, 12)) <= 0n
      || !Number.isSafeInteger(quotedAt) || quotedAt <= 0
      || now - quotedAt >= MAX_AGE_MS || quotedAt > now + 60_000) {
      throw new Error('Invalid or stale OKX GRAM price')
    }
    this.quote = { price, quotedAt }
    this.nextRefreshAt = now + REFRESH_MS
    return this.quote
  }
}

const tonUsdPrice = new TonUsdPrice()

module.exports = { TonUsdPrice, tonUsdPrice, REFRESH_MS }
