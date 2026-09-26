const mongoose = require('mongoose')

const opts = { versionKey: false, autoIndex: false }
const addressSchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  address: { type: String, required: true },
  tag: { type: String, default: '' },
  is_deleted: { type: Boolean, default: false },
  notifications: {
    is_enabled: { type: Boolean, default: true },
    min_amount: { type: mongoose.Schema.Types.Decimal128, default: 0 },
    exceptions: { type: [String], default: [] },
    inclusion: { type: [String], default: [] },
  },
  counters: { send_coins: { type: Number, default: 0 } },
}, { ...opts, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

const userSchema = new mongoose.Schema({
  user_id: { type: Number, required: true, unique: true },
  first_name: { type: String, required: true },
  last_name: String,
  language_code: String,
  language: { type: String, default: 'en' },
  is_blocked: { type: Boolean, default: false },
  is_deactivated: { type: Boolean, default: false },
  last_activity_at: Date,
}, { ...opts, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

const sessionSchema = new mongoose.Schema({
  user_id: Number, chat_id: Number, data: mongoose.Schema.Types.Mixed,
}, opts)
const counterSchema = new mongoose.Schema({ name: { type: String, unique: true }, data: mongoose.Schema.Types.Mixed },
  { ...opts, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
const deliverySchema = new mongoose.Schema({
  _id: String, status: String, lease_until: Date, attempts: Number,
  user_id: String, address_id: String, action_id: String, sent_at: Date,
  last_error: String, chat_id: mongoose.Schema.Types.Mixed, text: String,
  next_attempt_at: Date, created_at: Date,
}, { ...opts, collection: 'notification_deliveries' })

module.exports = {
  mongoose,
  Address: mongoose.model('address', addressSchema, 'addresses'),
  User: mongoose.model('user', userSchema, 'users'),
  Session: mongoose.model('sessions', sessionSchema, 'sessions'),
  Counter: mongoose.model('counters', counterSchema, 'counters'),
  Delivery: mongoose.model('notification_delivery', deliverySchema, 'notification_deliveries'),
}
