const mongoose = require('mongoose');

const incomeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    monthId: { type: mongoose.Schema.Types.ObjectId, ref: 'Month', required: true },
    label: { type: String, required: true, trim: true, maxlength: 100 },
    amount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

incomeSchema.index({ monthId: 1, userId: 1 });

module.exports = mongoose.model('Income', incomeSchema);
