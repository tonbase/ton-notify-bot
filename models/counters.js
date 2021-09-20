const mongoose = require('mongoose')

const countersSchema = new mongoose.Schema(
  {
    send_notifications: Number,
  },
  {
    versionKey: false,
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
)

module.exports = mongoose.model('counters', countersSchema)
