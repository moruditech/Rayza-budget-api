const mongoose = require('mongoose');

const rolloverDecisionSchema = new mongoose.Schema(
  {
    potId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pot', required: true },
    action: { type: String, enum: ['RESET', 'ROLLOVER', 'SWEEP'], required: true },
    // SWEEP only — the pot the surplus was moved into.
    targetPotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pot', default: null },
  },
  { _id: false }
);

const monthSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    isLocked: { type: Boolean, default: false },
    // Computed and stored at lock time by health.service.js — this is the
    // one exception to "computed fields are never stored", since a locked
    // month's score must stay fixed even as later months change.
    healthScore: { type: Number, default: null },
    rolloverDecisions: { type: [rolloverDecisionSchema], default: [] },
  },
  { timestamps: true }
);

// Prevents duplicate months for the same user, and makes "fetch this user's
// month for September 2025" a single index hit.
monthSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });
monthSchema.index({ userId: 1, isLocked: 1 });

module.exports = mongoose.model('Month', monthSchema);
