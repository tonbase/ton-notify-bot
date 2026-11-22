const { setTimeout: sleep } = require('node:timers/promises')

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

module.exports = { RequestLimiter }
