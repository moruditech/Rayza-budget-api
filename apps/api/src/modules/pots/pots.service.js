const mongoose = require('mongoose');
const { ERROR_CODES, LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const Pot = require('../../models/Pot.model');
const LineItem = require('../../models/LineItem.model');
const SpendLog = require('../../models/SpendLog.model');
const ApiError = require('../../utils/ApiError');
const monthService = require('../../services/month.service');

// spentAmount/committedAmount/remaining are never stored (see Pot.model.js)
// — always computed here at read time.
//   spentAmount     = instant spend logged against the pot
//   committedAmount = money allocated to the pot's sinking funds. It has
//                     left the pot's budget even though it is not spent:
//                     it sits in a fund (e.g. a Capitec investment plan).
//   usedAmount      = spentAmount + committedAmount
//   remaining       = budgetLimit + rolloverBalance - usedAmount
// `surplus` is kept as an alias of `remaining` for existing consumers.
function serializePot(pot, spentAmount = 0, committedAmount = 0) {
  const usedAmount = spentAmount + committedAmount;
  const remaining = pot.budgetLimit + pot.rolloverBalance - usedAmount;
  return {
    _id: pot._id,
    name: pot.name,
    icon: pot.icon,
    colour: pot.colour,
    type: pot.type,
    budgetLimit: pot.budgetLimit,
    rolloverBalance: pot.rolloverBalance,
    spentAmount,
    committedAmount,
    usedAmount,
    remaining,
    surplus: remaining,
    order: pot.order,
  };
}

/** potId -> spentAmount for every pot in a month. `monthId` must be an ObjectId. */
async function getSpendMapByMonth(userId, monthId) {
  const rows = await SpendLog.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        monthId,
        type: SPEND_LOG_TYPES.INSTANT_SPEND,
      },
    },
    { $group: { _id: '$potId', total: { $sum: '$amount' } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.total]));
}

/** spentAmount for a single pot. `potId` must be an ObjectId. */
async function getPotSpentAmount(userId, potId) {
  const rows = await SpendLog.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        potId,
        type: SPEND_LOG_TYPES.INSTANT_SPEND,
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return rows[0]?.total || 0;
}

// A fund's commitment = monthly allocation + one-off top-ups from the pot.
const COMMITTED_EXPR = { $add: ['$allocatedAmount', { $ifNull: ['$extraDeposited', 0] }] };

/** potId -> money allocated to sinking funds, for every pot in a month. */
async function getCommittedMapByMonth(userId, monthId) {
  const rows = await LineItem.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        monthId,
        type: LINE_ITEM_TYPES.SINKING_FUND,
      },
    },
    { $group: { _id: '$potId', total: { $sum: COMMITTED_EXPR } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.total]));
}

/** Money allocated to sinking funds in a single pot. `potId` must be an ObjectId. */
async function getPotCommittedAmount(userId, potId) {
  const rows = await LineItem.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        potId,
        type: LINE_ITEM_TYPES.SINKING_FUND,
      },
    },
    { $group: { _id: null, total: { $sum: COMMITTED_EXPR } } },
  ]);
  return rows[0]?.total || 0;
}

/** Fresh { spentAmount, committedAmount, usedAmount, remaining } for one pot document. */
async function getPotTotals(userId, pot) {
  const [spentAmount, committedAmount] = await Promise.all([
    getPotSpentAmount(userId, pot._id),
    getPotCommittedAmount(userId, pot._id),
  ]);
  const usedAmount = spentAmount + committedAmount;
  return {
    spentAmount,
    committedAmount,
    usedAmount,
    remaining: pot.budgetLimit + pot.rolloverBalance - usedAmount,
  };
}

/** Fetches a pot scoped to user + month, or throws 404 NOT_FOUND. Exported for lineItems.service.js. */
async function getPotOrThrow(userId, monthId, potId) {
  const pot = await Pot.findOne({ _id: potId, userId, monthId });
  if (!pot) {
    throw new ApiError(404, 'Pot not found', null, ERROR_CODES.NOT_FOUND);
  }
  return pot;
}

// FR-03 — get all pots for a month.
async function listPots(userId, monthId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  const [pots, spentMap, committedMap] = await Promise.all([
    Pot.find({ userId, monthId: month._id }).sort({ order: 1 }).lean(),
    getSpendMapByMonth(userId, month._id),
    getCommittedMapByMonth(userId, month._id),
  ]);
  return pots.map((pot) =>
    serializePot(pot, spentMap.get(String(pot._id)) || 0, committedMap.get(String(pot._id)) || 0)
  );
}

// FR-03 — create a pot. Sum of all pot Budget Limits must not exceed Total Monthly Income.
async function createPot(userId, monthId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const [totalIncome, currentBudgetLimits] = await Promise.all([
    monthService.getTotalIncome(userId, month._id),
    monthService.getTotalPotBudgetLimits(userId, month._id),
  ]);

  if (currentBudgetLimits + data.budgetLimit > totalIncome) {
    throw new ApiError(
      400,
      'Total pot Budget Limits cannot exceed Total Monthly Income',
      null,
      ERROR_CODES.BUDGET_EXCEEDED
    );
  }

  const pot = await Pot.create({
    userId,
    monthId: month._id,
    name: data.name,
    icon: data.icon ?? null,
    colour: data.colour ?? '#000000',
    type: data.type,
    budgetLimit: data.budgetLimit,
    order: data.order ?? 0,
  });

  return serializePot(pot.toObject(), 0);
}

// FR-03 — update a pot. Re-checks BUDGET_EXCEEDED only when budgetLimit actually changes.
async function updatePot(userId, monthId, potId, updates) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await getPotOrThrow(userId, month._id, potId);

  if (updates.budgetLimit !== undefined && updates.budgetLimit !== pot.budgetLimit) {
    const [totalIncome, otherBudgetLimits] = await Promise.all([
      monthService.getTotalIncome(userId, month._id),
      monthService.getTotalPotBudgetLimits(userId, month._id, { excludePotId: pot._id }),
    ]);
    if (otherBudgetLimits + updates.budgetLimit > totalIncome) {
      throw new ApiError(
        400,
        'Updated Budget Limit would push total pot Budget Limits over Total Monthly Income',
        null,
        ERROR_CODES.BUDGET_EXCEEDED
      );
    }
  }

  Object.assign(pot, updates);
  await pot.save();

  const { spentAmount, committedAmount } = await getPotTotals(userId, pot);
  return serializePot(pot.toObject(), spentAmount, committedAmount);
}

// FR-03 — delete a pot. Requires { force: true } if it has spend history.
// Cascades to its line items and (when force-deleted) their spend log
// entries, so nothing else in the API is left holding a dangling potId.
async function deletePot(userId, monthId, potId, { force } = {}) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await getPotOrThrow(userId, month._id, potId);

  const hasHistory = await SpendLog.exists({ userId, potId: pot._id });
  if (hasHistory && !force) {
    throw new ApiError(
      400,
      'This pot has spend history — pass { "force": true } to delete it anyway',
      null,
      ERROR_CODES.POT_HAS_HISTORY
    );
  }

  await Promise.all([
    LineItem.deleteMany({ userId, potId: pot._id }),
    SpendLog.deleteMany({ userId, potId: pot._id }),
  ]);
  await pot.deleteOne();
}

module.exports = {
  serializePot,
  getSpendMapByMonth,
  getPotSpentAmount,
  getCommittedMapByMonth,
  getPotCommittedAmount,
  getPotTotals,
  getPotOrThrow,
  listPots,
  createPot,
  updatePot,
  deletePot,
};
