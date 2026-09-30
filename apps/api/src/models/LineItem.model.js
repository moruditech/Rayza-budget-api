const mongoose = require('mongoose');
const { LINE_ITEM_TYPES } = require('@budget-app/shared');

const cycleHistoryEntrySchema = new mongoose.Schema(
  {
    usedAt: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 300, default: null },
  },
  { _id: false }
);

const lineItemSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    potId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pot', required: true },
    monthId: { type: mongoose.Schema.Types.ObjectId, ref: 'Month', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: Object.values(LINE_ITEM_TYPES), required: true },
    allocatedAmount: { type: Number, required: true, min: 0 },
    isRecurring: { type: Boolean, default: false },
    order: { type: Number, default: 0 },

    // ── SINKING_FUND fields only — null/zeroed on INSTANT_SPEND, see the
    //    pre-save hook below. ──────────────────────────────────────────
    targetAmount: { type: Number, default: null },
    monthlyContribution: { type: Number, default: null },
    accumulatedBalance: { type: Number, default: 0 },
    // One-off top-ups paid in from the pot's remaining budget THIS month.
    // Counted as used in the pot like allocatedAmount, but never carried
    // into the next month's allocation (only the balance carries over).
    extraDeposited: { type: Number, default: 0, min: 0 },
    // Interest actually paid into the fund so far, across all months (carried
    // forward on clone, like the balance).
    interestEarnedTotal: { type: Number, default: 0, min: 0 },
    isReadyToUse: { type: Boolean, default: false },
    // Bills: the day of the month this item is due (1-31, clamped to the
    // month's length). null = not a bill. isPaid is set by the person tapping
    // "Mark paid" and resets when the month is cloned.
    dueDay: { type: Number, default: null, min: 1, max: 31 },
    isPaid: { type: Boolean, default: false },
    paidAt: { type: Date, default: null },
    // Fixed annual interest rate as a percentage (e.g. 7.5 = 7.5% p.a.).
    // null = this fund earns no interest (e.g. cash left in a bank account).
    annualInterestRate: { type: Number, default: null, min: 0, max: 100 },
    // Date the person wants to project the future value to.
    targetDate: { type: Date, default: null },

    cycleHistory: { type: [cycleHistoryEntrySchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        // "When type = INSTANT_SPEND, sinking-fund fields are stripped from
        // the response entirely" — Data Models spec, §5.
        if (ret.type === LINE_ITEM_TYPES.INSTANT_SPEND) {
          delete ret.targetAmount;
          delete ret.monthlyContribution;
          delete ret.accumulatedBalance;
          delete ret.extraDeposited;
          delete ret.interestEarnedTotal;
          delete ret.isReadyToUse;
          delete ret.annualInterestRate;
          delete ret.targetDate;
          delete ret.cycleHistory;
        }
        delete ret.__v;
        return ret;
      },
    },
  }
);

// "targetAmount required when type is SINKING_FUND" (Data Models §8).
// Runs pre-validate and uses invalidate() so the failure surfaces as a
// normal Mongoose ValidationError → 422 VALIDATION_ERROR, the same shape
// every other schema violation takes.
lineItemSchema.pre('validate', function preValidateSinkingFundFields(next) {
  if (this.type === LINE_ITEM_TYPES.SINKING_FUND) {
    if (this.targetAmount == null) {
      this.invalidate('targetAmount', 'targetAmount is required for SINKING_FUND line items');
    }
    if (this.monthlyContribution == null) {
      this.invalidate(
        'monthlyContribution',
        'monthlyContribution is required for SINKING_FUND line items'
      );
    }
  }
  if (this.annualInterestRate != null && !this.targetDate) {
    this.invalidate('targetDate', 'targetDate is required when annualInterestRate is set');
  }
  next();
});

// "isReadyToUse auto-set when accumulatedBalance >= targetAmount" (Data
// Models §8). INSTANT_SPEND items never carry sinking-fund state, so they're
// normalized back to their zero/null defaults on every save regardless of
// what the caller sent — this is the model-level enforcement backing the
// lineItems.service.js INVALID_FIELDS_FOR_TYPE check at the API layer.
lineItemSchema.pre('save', function preSaveNormalize(next) {
  if (this.type === LINE_ITEM_TYPES.INSTANT_SPEND) {
    this.targetAmount = null;
    this.monthlyContribution = null;
    this.accumulatedBalance = 0;
    this.extraDeposited = 0;
    this.interestEarnedTotal = 0;
    this.isReadyToUse = false;
    this.annualInterestRate = null;
    this.targetDate = null;
  } else {
    this.isReadyToUse = this.targetAmount != null && this.accumulatedBalance >= this.targetAmount;
  }
  next();
});

lineItemSchema.index({ potId: 1, userId: 1 });
lineItemSchema.index({ monthId: 1, userId: 1 });
lineItemSchema.index({ userId: 1, isRecurring: 1 });
lineItemSchema.index({ userId: 1, isReadyToUse: 1 });

module.exports = mongoose.model('LineItem', lineItemSchema);
