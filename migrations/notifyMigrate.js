const mongoose = require('mongoose')
const config = require('../config')
const AddressModel = require('../models/address')
const log = require('../utils/log')

mongoose
  .connect(config.get('db'))
  .then(async () => {
    await AddressModel.updateMany({}, [
      {
        $set: {
          'notifications.is_enabled': {
            $cond: {
              if: { $eq: ['$notifications', true] },
              then: true,
              else: false,
            },
          },
        },
      },
    ])
    log.info('Migration completed')
    process.exit(1)
  })
