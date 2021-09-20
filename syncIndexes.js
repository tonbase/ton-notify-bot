const fs = require('fs')
const mongoose = require('mongoose')

const config = require('./config')

const modelsPath = './models'

// eslint-disable-next-line import/no-dynamic-require
const models = fs.readdirSync(modelsPath).map((v) => require(`${modelsPath}/${v}`))

void (async () => {
  await mongoose.connect(config.get('db'))

  for (const model of models) {
    console.log(`Updating indexes for ${model.modelName}`)
    await model.syncIndexes({background: true})
    console.log(await model.listIndexes())
  }
  console.log('done')
  process.exit(0)
})()
