const mongoose = require('mongoose');
const { LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const Income = require('../models/Income.model');
const Pot = require('../models/Pot.model');
const LineItem = require('../models/LineItem.model');
const SpendLog = require('../models/SpendLog.model');

// Point weights aren't specified anywhere in the docs beyond "positive" /
// "negative" per factor — these are a reasonable, easily-retunable default.
// Score starts at 100 and is deducted for each violated factor, floored at 0.
const WEIGHTS = {
  OVER_INCOME: 20,
  POT_OVER_BUDGET: 10,
  POT_OVER_BUDGET_CAP: 30,
  UNALLOCATED_INCOME: 15,
  MISSED_CONTRIBUTION: 10,
  MISSED_CONTRIBUTION_CAP: 20,
};

/**
 * FR-12 — computes the 0-100 Budget Health Score for a month at lock time.
 * Deliberately queries Income/Pot/LineItem/SpendLog directly rather than
 * going through month.service.js's totals helpers — month.service.js calls
 * this function from lockMonth(), so depending on it back would be a
 * circular require. `monthId` must be an ObjectId (e.g. month._id).
 */
async function computeHealthScore(userId, monthId) {
  const uid = new mongoose.Types.ObjectId(userId);

  const [incomeRows, pots, sinkingFundItems, spendRows] = await Promise.all([
    Income.aggregate([
      { $match: { userId: uid, monthId } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Pot.find({ userId, monthId }).lean(),
    LineItem.find({ userId, monthId, type: LINE_ITEM_TYPES.SINKING_FUND }).lean(),
    SpendLog.aggregate([
      { $match: { userId: uid, monthId, type: SPEND_LOG_TYPES.INSTANT_SPEND } },
      { $group: { _id: '$potId', total: { $sum: '$amount' } } },
    ]),
  ]);

  const totalIncome = incomeRows[0]?.total || 0;
  const totalBudgetLimit = pots.reduce((sum, pot) => sum + pot.budgetLimit, 0);
  const spentByPot = new Map(spendRows.map((row) => [String(row._id), row.total]));

  let score = 100;

  // "Total spending stayed within income" / negative counterpart.
  // Money allocated to sinking funds counts as used just like a spend does.
  const committedByPot = new Map();
  for (const li of sinkingFundItems) {
    const key = String(li.potId);
    committedByPot.set(key, (committedByPot.get(key) || 0) + li.allocatedAmount);
  }
  const usedFor = (pot) =>
    (spentByPot.get(String(pot._id)) || 0) + (committedByPot.get(String(pot._id)) || 0);

  const totalSpent = pots.reduce((sum, pot) => sum + usedFor(pot), 0);
  if (totalSpent > totalIncome) {
    score -= WEIGHTS.OVER_INCOME;
  }

  // "A pot exceeded its Budget Limit" — negative, per over-budget pot.
  const overBudgetCount = pots.filter((pot) => {
    return usedFor(pot) > pot.budgetLimit + pot.rolloverBalance;
  }).length;
  score -= Math.min(overBudgetCount * WEIGHTS.POT_OVER_BUDGET, WEIGHTS.POT_OVER_BUDGET_CAP);

  // "Unallocated Income = R0" — positive; anything left over is negative.
  if (totalIncome - totalBudgetLimit > 0) {
    score -= WEIGHTS.UNALLOCATED_INCOME;
  }

  // "A sinking fund contribution was missed" — negative. NOTE: under this
  // implementation, monthly contributions are applied automatically at
  // clone time (see sinkingFund.service.js), so in normal operation a
  // contribution can't actually be "missed" — this check only catches the
  // edge case of a fund with a contribution configured but a balance that
  // was never carried forward (e.g. created and never cloned into).
  const missedCount = sinkingFundItems.filter(
    (li) => li.monthlyContribution > 0 && li.accumulatedBalance === 0
  ).length;
  score -= Math.min(missedCount * WEIGHTS.MISSED_CONTRIBUTION, WEIGHTS.MISSED_CONTRIBUTION_CAP);

  return Math.max(0, Math.min(100, Math.round(score)));
}

module.exports = { computeHealthScore };
