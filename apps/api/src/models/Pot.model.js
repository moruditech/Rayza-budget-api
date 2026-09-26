const mongoose = require('mongoose');
const { POT_TYPES } = require('@budget-app/shared');

const potSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    monthId: { type: mongoose.Schema.Types.ObjectId, ref: 'Month', required: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    icon: { type: String, default: null },
    colour: { type: String, default: '#000000' },
    type: { type: String, enum: Object.values(POT_TYPES), required: true },
    budgetLimit: { type: Number, required: true, min: 0 },
    // Surplus carried in from a previous month's ROLLOVER decision.
    rolloverBalance: { type: Number, default: 0 },
    // Display order on the dashboard.
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// spentAmount and surplus are intentionally NOT schema fields. Per the Data
// Models spec they are computed on read from SpendLog:
//   spentAmount = sum(SpendLog.amount) where potId matches and type = INSTANT_SPEND
//   surplus     = budgetLimit + rolloverBalance - spentAmount
// That aggregation is done in pots.service.js (Phase 3) — never store it here.

potSchema.index({ monthId: 1, userId: 1 });
potSchema.index({ userId: 1 });

module.exports = mongoose.model('Pot', potSchema);
