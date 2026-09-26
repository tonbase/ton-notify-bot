function formatUnits(value, decimals = 9, maxFraction = 9) {
  const negative = String(value).startsWith('-')
  const digits = String(value).replace(/^-/, '')
  if (!/^\d+$/.test(digits) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    return String(value)
  }
  const padded = digits.padStart(decimals + 1, '0')
  const whole = decimals ? padded.slice(0, -decimals) : padded
  const fractional = decimals ? padded.slice(-decimals).slice(0, maxFraction).replace(/0+$/, '') : ''
  const grouped = BigInt(whole).toLocaleString('en-US')
  return `${negative ? '-' : ''}${grouped}${fractional ? `.${fractional}` : ''}`
}

function toNano(value) {
  if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const nano = (BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0') || '0')).toString()
  return nano.length <= 34 ? nano : null
}

// Display the exact amount, trimming only insignificant trailing zeroes.
function formatDisplayUnits(value, decimals = 9) {
  return formatUnits(value, decimals, decimals)
}

module.exports = { formatUnits, formatDisplayUnits, toNano }
