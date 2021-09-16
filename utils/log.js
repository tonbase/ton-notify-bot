const winston = require('winston')
const chalk = require('chalk')

module.exports = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.Console(),
  ],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((info) => {
      const color = winston.format.colorize.Colorizer.allColors[info.level]
      return [
        chalk[color](`${info.level[0].toUpperCase()} `),
        `${info.timestamp} `,
        info.message,
      ].join('')
    }),
  ),
})
