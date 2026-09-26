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

// Compact summaries use an explicit approximation; tiny values never round to zero.
function formatDisplayUnits(value, decimals = 9) {
  const exact = formatUnits(value, decimals, decimals)
  if (!/^-?\d+$/.test(String(value)) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return exact
  const [whole, fraction = ''] = exact.replace(/^-/, '').split('.')
  const precision = whole.replaceAll(',', '') === '0' ? Math.max(6, fraction.search(/[1-9]/) + 4) : 6
  if (fraction.length <= precision) return exact
  const divisor = 10n ** BigInt(decimals - precision)
  const rounded = (BigInt(String(value).replace(/^-/, '')) + divisor / 2n) / divisor
  return `≈${formatUnits(`${String(value).startsWith('-') ? '-' : ''}${rounded}`, precision, precision)}`
}

module.exports = { formatUnits, formatDisplayUnits, toNano }
