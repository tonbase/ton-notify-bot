const { Composer, BaseScene } = require('telegraf')
const clearExceptions = require('../handlers/clearExceptions')
const editExceptions = require('../handlers/editExceptions')

const editExceptionsScene = new BaseScene('editExceptions')

editExceptionsScene.action('clear_exceptions', Composer.tap(clearExceptions))

editExceptionsScene.on('text', Composer.tap(editExceptions))

module.exports = editExceptionsScene
