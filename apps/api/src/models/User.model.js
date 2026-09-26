const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // `unique: true` both validates and creates the required unique index
    // documented in the Data Models spec ("Indexes: email — unique").
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        // Defense in depth — the auth service already builds response
        // objects field-by-field, but this guarantees passwordHash can
        // never leak if a User document is ever serialized directly.
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('User', userSchema);
