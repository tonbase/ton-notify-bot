const escapedChars = {
  '"': '&quot;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

module.exports = (string) => {
  const chars = [...string]
  return chars.map((char) => escapedChars[char] || char).join('')
}
