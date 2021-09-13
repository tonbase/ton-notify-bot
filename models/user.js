const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    userId: { type: Number, required: true, unique: true },
    firstName: { type: String, required: true },
    lastName: { type: String },
    languageCode: { type: String },
    isDeactivated: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    language: { type: String, default: "en" },
    lastActivityAt: Date,
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model("user", userSchema);
