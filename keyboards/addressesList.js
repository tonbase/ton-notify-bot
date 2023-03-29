const { Markup: m } = require('telegraf')
const { PAGINATION_LIMIT } = require('../constants')
const formatAddress = require('../utils/formatAddress')

const generatePaginationKeyboard = (current, count, prefix) => {
  let keyboard = []

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
  let action_two
  if (current === 1) {
    two = `· 2 ·`
    action_two = 1
  } else if (current >= 3) {
    action_two = current - 1
    two = `‹ ${two}`
  }

  if ((current + 1 === count - 1) || (current + 1 === count)) {
    action_two = count - 4
    two = `‹ ${count - 3}`
  }

  if (!action_two) {
    action_two = 1
  }

  keyboard.push(m.callbackButton(two, `${prefix}${action_two}`))

  let three = current > 2 ? current + 1 : 3, action_three
  if (current === 2) {
    action_three = 2
    three = `· 3 ·`
  } else if (current > 2) {
    action_three = current
    three = `· ${current + 1} ·`
  }

  if ((current + 1 === count - 1) || (current + 1 === count)) {
    action_three = count - 3
    three = count - 2
  }

  if (!action_three) {
    action_three = 2
  }

  keyboard.push(m.callbackButton(three, `${prefix}${action_three}`))

  let four, action_four
  if (current <= 2) {
    four = `4 ›`
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

  action_four = (current + 1 === count) || (current + 1 === count - 1) ? count - 2 : current + 1

  if (current <= 2) {
    action_four = 3
  }

  keyboard.push(m.callbackButton(four, `${prefix}${action_four}`))

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
      generatePaginationKeyboard(current, pagesCount, 'list_')
    )
  }

  return m.inlineKeyboard(addressesListKeyboard)
}
