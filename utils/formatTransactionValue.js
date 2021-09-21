const formatBigNumberStr = require('./formatBigNumberStr')

module.exports = (str) => {
  const formatted = formatBigNumberStr(str)
  return formatted.includes('.') ? formatted : `${formatted}.00`
}
