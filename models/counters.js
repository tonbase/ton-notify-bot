const mongoose = require('mongoose')

const countersSchema = new mongoose.Schema({
  send_notifications: Number,
})

module.exports = mongoose.model('counters', countersSchema)
