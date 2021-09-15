const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    user_id: { type: Number, required: true, unique: true },
    first_name: { type: String, required: true },
    last_name: { type: String },
    language_code: { type: String },
    is_deactivated: { type: Boolean, default: false },
    is_blocked: { type: Boolean, default: false },
    language: { type: String, default: 'en' },
    last_activity_at: Date,
  },
  {
    versionKey: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
)

module.exports = mongoose.model('user', userSchema)
