const mongoose = require('mongoose')

const schema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['master', 'shard'],
    required: true,
  },
  workchain: { type: Number, required: false },
  shard: { type: String, required: false },
  seqno: { type: Number, required: true },
  root_hash: { type: String, required: false },
  file_hash: { type: String, required: false },
  processed: { type: Boolean, required: true, default: false },
}, {
  timestamps: {
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  autoIndex: false,
})

schema.index({ type: 1, processed: 1, seqno: 1 })
schema.index({ type: 1, workchain: 1, shard: 1, seqno: 1, root_hash: 1, file_hash: 1 })

module.exports = mongoose.model('Block', schema)
