const mongoose = require('mongoose')

const addressSchema = new mongoose.Schema(
  {
    user_id: { type: Number, unique: false, required: true },
    address: { type: String, unique: false, required: true },
    tag: { type: String, default: '' },
    is_deleted: { type: Boolean, default: false },
    notifications: { type: Boolean, default: true },
    counters: {
      send_coins: { type: Number, default: 0 },
    },
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
)

addressSchema.index({ user_id: 1, address: 1 }, { unique: true })

module.exports = mongoose.model('address', addressSchema)
