const { Composer, BaseScene } = require('telegraf')
const editMinAmount = require('../handlers/editMinAmount')
const resetMinAmount = require('../handlers/resetMinAmount')

const editMinAmountScene = new BaseScene('editMinAmount')

editMinAmountScene.action('reset_min_amount', Composer.tap(resetMinAmount))

editMinAmountScene.on('text', Composer.tap(editMinAmount))

module.exports = editMinAmountScene
