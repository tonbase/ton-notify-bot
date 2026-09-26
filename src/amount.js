// Decimal128 may serialize an integer threshold as 1E+9. Parse it and decimal
// user input without passing amounts through floating-point numbers.
function scaledInteger(value, decimals = 0) {
  const input = String(value).trim()
  if (input.length > 2048) return null
  const match = input.match(/^(-?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i)
  if (!match) return null
  const fraction = match[3] ?? match[4] ?? ''
  const digits = ((match[2] || '0') + fraction).replace(/^0+/, '') || '0'
  if (digits === '0') return '0'
  if (match[1]) return null
  const exponent = Number(match[5] || 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null
  const shift = decimals + exponent - fraction.length
  if (shift >= 0) return digits + '0'.repeat(shift)
  const cut = digits.length + shift
  if (cut <= 0 || /[1-9]/.test(digits.slice(cut))) return null
  return digits.slice(0, cut)
}

function formatUnits(value, decimals = 9, maxFraction = 9) {
  const negative = String(value).startsWith('-')
  const digits = scaledInteger(String(value).replace(/^-/, ''))
  if (digits === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return String(value)
  }
  const padded = digits.padStart(decimals + 1, '0')
  const whole = decimals ? padded.slice(0, -decimals) : padded
  const fractional = decimals ? padded.slice(-decimals).slice(0, maxFraction).replace(/0+$/, '') : ''
  const grouped = BigInt(whole).toLocaleString('en-US')
  return `${negative ? '-' : ''}${grouped}${fractional ? `.${fractional}` : ''}`
}

function toNano(value) {
  const nano = scaledInteger(value, 9)
  return nano !== null && nano.length <= 34 ? nano : null
}

// Display the exact amount, trimming only insignificant trailing zeroes.
function formatDisplayUnits(value, decimals = 9) {
  return formatUnits(value, decimals, decimals)
}

module.exports = { formatUnits, formatDisplayUnits, toNano, scaledInteger }
