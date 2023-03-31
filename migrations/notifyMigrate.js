const mongoose = require('mongoose')
const config = require('../config')
const AddressModel = require('../models/address')

mongoose
  .connect(config.get('db'))
  .then(async () => {
    AddressModel.updateMany(
      {},
      {
        $set: { 'notifications.is_enabled': { $ifNull: ['$notifications', true] } },
        $unset: { notifications: '' },
      },
    )
  })
