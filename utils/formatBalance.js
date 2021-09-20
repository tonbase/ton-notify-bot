const formatBigNumberStr = require('./formatBigNumberStr')

module.exports = (value) => {
  if (value.gte(1)) {
    return formatBigNumberStr(value.toFixed(0, 0))
  }
  const str = value.toFixed(9, 0)
  let index = -1
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] !== '0') {
      index = i
      break
    }
  }
  return str.slice(0, index)
}
