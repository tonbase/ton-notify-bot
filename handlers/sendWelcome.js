const { Extra } = require('telegraf')

module.exports = ({ replyWithHTML, i18n }) => {
  return replyWithHTML(i18n.t('welcome'), Extra.webPreview(false))
}
