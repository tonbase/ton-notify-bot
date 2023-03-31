const { Composer, BaseScene } = require('telegraf')
const editMinAmount = require('../handlers/editMinAmount')

const editMinAmountScene = new BaseScene('editMinAmout')

editMinAmountScene.on('text', Composer.tap(editMinAmount))

module.exports = editMinAmountScene
