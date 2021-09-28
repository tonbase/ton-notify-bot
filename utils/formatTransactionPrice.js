const formatBigNumberStr = require('./formatBigNumberStr')

module.exports = (price) => {
  if (price.lt(0.01)) {
    return ''
  }
  return price.gte(1) ? formatBigNumberStr(price.toFixed(0, 0)) : price.toFixed(2, 0)
}
