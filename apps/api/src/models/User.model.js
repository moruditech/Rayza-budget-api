const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // `unique: true` both validates and creates the required unique index
    // documented in the Data Models spec ("Indexes: email — unique").
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Which version of the Terms / Privacy / Cookie policies the person accepted
    // (see LEGAL_VERSION in @budget-app/shared) and when.
    consentVersion: { type: String, default: null },
    consentAt: { type: Date, default: null },
    // Refresh tokens issued before this moment are rejected — set when the
    // password is reset so every other device is signed out.
    sessionsValidAfter: { type: Date, default: null },
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
