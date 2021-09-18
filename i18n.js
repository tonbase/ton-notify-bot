const TelegrafI18n = require('telegraf-i18n')
const path = require('path')

module.exports = new TelegrafI18n({
  defaultLanguage: 'en',
  directory: path.resolve(__dirname, 'locales'),
})