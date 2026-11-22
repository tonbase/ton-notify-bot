const mongoose = require('mongoose')
mongoose.set('bufferCommands', false)

const opts = { versionKey: false, autoIndex: false }
const addressSchema = new mongoose.Schema({
  user_id: { type: Number, required: true },
  address: { type: String, required: true },
  tag: { type: String, default: '' },
  is_deleted: { type: Boolean, default: false },
  notifications: {
    is_enabled: { type: Boolean, default: true },
    filter_dust: { type: Boolean, default: true },
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
  _id: String, status: String, delivery_kind: String, delivery_lane: String, lease_until: Date, attempts: Number,
  user_id: String, address_id: String, action_id: String, sent_at: Date,
  last_error: String, chat_id: mongoose.Schema.Types.Mixed, chat_type: String, text: String, rich_html: String,
  next_attempt_at: Date, created_at: Date,
  skip_reason: String,
  filter_action: {
    type: { type: String }, success: Boolean,
    details: { source: String, destination: String, value: String },
  },
  digest: {
    address: String, window_start: Date, window_end: Date, format_version: Number,
  },
  digest_count: Number,
}, { ...opts, collection: 'notification_deliveries' })
const digestWindowSchema = new mongoose.Schema({
  _id: String,
  action_ids: { type: [String], default: [] },
  created_at: { type: Date, default: Date.now },
}, { ...opts, collection: 'notification_digest_windows' })
const digestEventSchema = new mongoose.Schema({
  _id: String, type: String, success: Boolean, utime: Number, direction: String,
  source: String, destination: String, source_label: String, destination_label: String,
  asset: String, amount: String, decimals: Number, symbol: String, text: String, transaction_hash: String,
  created_at: { type: Date, default: Date.now },
}, { ...opts, collection: 'notification_digest_events' })
module.exports = {
  mongoose,
  Address: mongoose.model('address', addressSchema, 'addresses'),
  User: mongoose.model('user', userSchema, 'users'),
  Session: mongoose.model('sessions', sessionSchema, 'sessions'),
  Counter: mongoose.model('counters', counterSchema, 'counters'),
  Delivery: mongoose.model('notification_delivery', deliverySchema, 'notification_deliveries'),
  DigestWindow: mongoose.model('notification_digest_window', digestWindowSchema, 'notification_digest_windows'),
  DigestEvent: mongoose.model('notification_digest_event', digestEventSchema, 'notification_digest_events'),
}
