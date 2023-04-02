const mongoose = require('mongoose')

const schemaTypes = mongoose.Schema.Types
const addressSchema = new mongoose.Schema(
  {
    user_id: { type: Number, unique: false, required: true },
    address: { type: String, unique: false, required: true },
    tag: { type: String, default: '' },
    is_deleted: { type: Boolean, default: false },
    notifications: {
      is_enabled: { type: Boolean, default: true },
      min_amount: {
        type: schemaTypes.Decimal128,
        default: 0,
      },
      exceptions: {
        type: [String],
        default: [],
      },
    },
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
