const { Composer, BaseScene } = require('telegraf')
const clearInclusion = require('../handlers/clearInclusion')
const editInclusion = require('../handlers/editInclusion')

const editInclusionScene = new BaseScene('editInclusion')

editInclusionScene.action('clear_inclusion', Composer.tap(clearInclusion))

editInclusionScene.on('text', Composer.tap(editInclusion))

module.exports = editInclusionScene
