const Big = require('big.js')
const formatBigNumberStr = require('./formatBigNumberStr')

module.exports = (value) => {
  const balance = new Big(value)
  if (balance.gte(1)) {
    return formatBigNumberStr(balance.toFixed(0, 0))
  }
  const str = balance.toFixed(9, 0)
  let index = 1
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] !== '0' && Number(str[i])) {
      index = i + 1
      break
    }
  }
  return str.slice(0, index)
}
