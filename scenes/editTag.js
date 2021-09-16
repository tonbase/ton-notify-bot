const { Composer, BaseScene, Stage } = require('telegraf')
const editTag = require('../handlers/editTag')

const editTagScene = new BaseScene('editTag')

editTagScene.on('text', Composer.tap(editTag))

editTagScene.use(Composer.tap(Stage.leave()))

module.exports = editTagScene
