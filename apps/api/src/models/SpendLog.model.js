const mongoose = require('mongoose');
const { PAYMENT_METHODS, SPEND_LOG_TYPES } = require('@budget-app/shared');

const spendLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    monthId: { type: mongoose.Schema.Types.ObjectId, ref: 'Month', required: true },
    potId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pot', required: true },
    lineItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'LineItem', required: true },

    type: { type: String, enum: Object.values(SPEND_LOG_TYPES), required: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 300, default: null },
    // Links the OUT and IN entries created by a fund-to-fund transfer.
    transferId: { type: mongoose.Schema.Types.ObjectId, default: null },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      default: PAYMENT_METHODS.OTHER,
    },
  },
  { timestamps: true }
);

spendLogSchema.index({ userId: 1, monthId: 1 });
spendLogSchema.index({ userId: 1, potId: 1 });
spendLogSchema.index({ userId: 1, lineItemId: 1 });
spendLogSchema.index({ userId: 1, date: -1 });
spendLogSchema.index({ userId: 1, paymentMethod: 1 });

module.exports = mongoose.model('SpendLog', spendLogSchema);
