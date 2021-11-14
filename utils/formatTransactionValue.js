const Big = require('big.js')
const formatBigNumberStr = require('./formatBigNumberStr')

module.exports = (str) => {
  if (new Big(str).gte(10)) {
    str = new Big(str).toFixed(0, 0)
  }
  return formatBigNumberStr(str)
}
