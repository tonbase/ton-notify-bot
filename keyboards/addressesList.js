const { Markup: m } = require('telegraf')
const { PAGINATION_LIMIT } = require('../constants')
const formatAddress = require('../utils/formatAddress')

const generatePaginationKeyboard = (current, count, prefix) => {
  const keyboard = []

  if (count <= 5) {
    return Array.from({ length: count }, (_, index) => index + 1).map((index) => {
      const text = current + 1 === index ? `· ${index} ·` : `${index}`
      return m.callbackButton(text, `${prefix}${index - 1}`)
    })
  }

  let one = 1
  if (current === 0) {
    one = '· 1 ·'
  } else if (current > 2) {
    one = '« 1'
  }
  keyboard.push(m.callbackButton(one, `${prefix}0`))

  let two = current <= 2 ? 2 : current
  let actionTwo
  if (current === 1) {
    two = '· 2 ·'
    actionTwo = 1
  } else if (current >= 3) {
    actionTwo = current - 1
    two = `‹ ${two}`
  }

  if ((current + 1 === count - 1) || (current + 1 === count)) {
    actionTwo = count - 4
    two = `‹ ${count - 3}`
  }

  if (!actionTwo) {
    actionTwo = 1
  }

  keyboard.push(m.callbackButton(two, `${prefix}${actionTwo}`))

  let actionThree
  let three = current > 2 ? current + 1 : 3
  if (current === 2) {
    actionThree = 2
    three = '· 3 ·'
  } else if (current > 2) {
    actionThree = current
    three = `· ${current + 1} ·`
  }

  if ((current + 1 === count - 1) || (current + 1 === count)) {
    actionThree = count - 3
    three = count - 2
  }

  if (!actionThree) {
    actionThree = 2
  }

  keyboard.push(m.callbackButton(three, `${prefix}${actionThree}`))

  let actionFour
  let four
  if (current <= 2) {
    four = '4 ›'
  } else {
    four = `${current + 2}`
    if (!(current + 2 === count - 1)) {
      four += ' ›'
    }
  }

  if ((current + 1 === count - 1)) {
    four = `· ${(count - 1)} ·`
  }

  if (current + 1 === count) {
    four = count - 1
  }

  actionFour = (current + 1 === count) || (current + 1 === count - 1) ? count - 2 : current + 1

  if (current <= 2) {
    actionFour = 3
  }

  keyboard.push(m.callbackButton(four, `${prefix}${actionFour}`))

  let five = count
  if (!(current + 2 === count - 1)) {
    five += ' »'
  }

  if (current + 1 === count - 1) {
    five = count
  }

  if (current + 1 === count) {
    five = `· ${count} ·`
  }

  keyboard.push(m.callbackButton(five, `${prefix}${count - 1}`))

  return keyboard
}

module.exports = (addresses, pagination) => {
  const buttons = addresses.map(({ _id, address, tag }) => {
    const text = tag ? `${tag}: ${formatAddress(address)}` : formatAddress(address)
    return [m.callbackButton(text, `open_${_id}`)]
  })

  const { current, total_count: totalCount } = pagination
  const pagesCount = Math.ceil(totalCount / PAGINATION_LIMIT)

  const addressesListKeyboard = [...buttons]
  if (pagesCount > 1) {
    addressesListKeyboard.push(
      generatePaginationKeyboard(current, pagesCount, 'list_'),
    )
  }

  return m.inlineKeyboard(addressesListKeyboard)
}
