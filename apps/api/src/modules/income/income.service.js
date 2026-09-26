const { ERROR_CODES } = require('@budget-app/shared');
const Income = require('../../models/Income.model');
const ApiError = require('../../utils/ApiError');
const monthService = require('../../services/month.service');

function serializeIncome(income) {
  return { _id: income._id, label: income.label, amount: income.amount };
}

// FR-02 — get all income sources for a month.
async function listIncome(userId, monthId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  const income = await Income.find({ userId, monthId: month._id }).sort({ createdAt: 1 }).lean();
  return income.map(serializeIncome);
}

// FR-02 — add an income source. Adding income only ever raises the total,
// so it can never violate "sum of pot Budget Limits <= Total Income" — no
// INCOME_BELOW_ALLOCATIONS check is possible to fail here.
async function createIncome(userId, monthId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const income = await Income.create({
    userId,
    monthId: month._id,
    label: data.label,
    amount: data.amount,
  });
  return serializeIncome(income);
}

// FR-02 — update an income source. Only a decrease in amount can push the
// total below existing pot Budget Limits, so that's the only case checked.
async function updateIncome(userId, monthId, incomeId, updates) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const income = await Income.findOne({ _id: incomeId, userId, monthId: month._id });
  if (!income) {
    throw new ApiError(404, 'Income source not found', null, ERROR_CODES.NOT_FOUND);
  }

  if (updates.amount !== undefined && updates.amount < income.amount) {
    const [totalIncome, totalBudgetLimits] = await Promise.all([
      monthService.getTotalIncome(userId, month._id),
      monthService.getTotalPotBudgetLimits(userId, month._id),
    ]);
    const newTotalIncome = totalIncome - income.amount + updates.amount;
    if (totalBudgetLimits > newTotalIncome) {
      throw new ApiError(
        400,
        'Reducing this income source would push total income below total pot Budget Limits',
        null,
        ERROR_CODES.INCOME_BELOW_ALLOCATIONS
      );
    }
  }

  Object.assign(income, updates);
  await income.save();
  return serializeIncome(income);
}

// FR-02 — delete an income source, guarded the same way as a decrease.
async function deleteIncome(userId, monthId, incomeId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const income = await Income.findOne({ _id: incomeId, userId, monthId: month._id });
  if (!income) {
    throw new ApiError(404, 'Income source not found', null, ERROR_CODES.NOT_FOUND);
  }

  const [totalIncome, totalBudgetLimits] = await Promise.all([
    monthService.getTotalIncome(userId, month._id),
    monthService.getTotalPotBudgetLimits(userId, month._id),
  ]);
  const newTotalIncome = totalIncome - income.amount;
  if (totalBudgetLimits > newTotalIncome) {
    throw new ApiError(
      400,
      'Deleting this income source would push total income below total pot Budget Limits',
      null,
      ERROR_CODES.INCOME_BELOW_ALLOCATIONS
    );
  }

  await income.deleteOne();
}

module.exports = { listIncome, createIncome, updateIncome, deleteIncome };
