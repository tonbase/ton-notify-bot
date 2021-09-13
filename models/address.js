const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    userId: { type: Number, unique: false, required: true },
    address: { type: String, unique: false, required: true },
    tag: { type: String },
    isDeleted: { type: Boolean, default: false },
    notifications: { type: Boolean, default: true },
  },
  { versionKey: false, timestamps: true }
);

addressSchema.index({ userId: 1, address: 1 }, { unique: true });

module.exports = mongoose.model("address", addressSchema);
