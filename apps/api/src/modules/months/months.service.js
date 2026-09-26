const mongoose = require('mongoose');
const Month = require('../../models/Month.model');
const Income = require('../../models/Income.model');
const Pot = require('../../models/Pot.model');
const LineItem = require('../../models/LineItem.model');
const monthService = require('../../services/month.service');
const potsService = require('../pots/pots.service');
const lineItemsService = require('../lineItems/lineItems.service');

// FR-08 — list all months for the user (summary), newest first.
async function listMonths(userId) {
  const rows = await Month.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $sort: { year: -1, month: -1 } },
    {
      $lookup: {
        from: 'incomes',
        let: { monthId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$monthId', '$$monthId'] } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
        as: 'incomeAgg',
      },
    },
    {
      $lookup: {
        from: 'pots',
        let: { monthId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$monthId', '$$monthId'] } } },
          { $group: { _id: null, total: { $sum: '$budgetLimit' }, count: { $sum: 1 } } },
        ],
        as: 'potAgg',
      },
    },
    {
      $project: {
        _id: 1,
        year: 1,
        month: 1,
        isLocked: 1,
        healthScore: 1,
        totalIncome: { $ifNull: [{ $arrayElemAt: ['$incomeAgg.total', 0] }, 0] },
        totalBudgetLimit: { $ifNull: [{ $arrayElemAt: ['$potAgg.total', 0] }, 0] },
        potCount: { $ifNull: [{ $arrayElemAt: ['$potAgg.count', 0] }, 0] },
      },
    },
  ]);

  return rows.map((row) => ({
    ...row,
    unallocatedIncome: row.totalIncome - row.totalBudgetLimit,
  }));
}

// FR-08 — get one month with full detail: income, pots, and each pot's
// line items nested, all computed fields included.
async function getMonthDetail(userId, monthId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);

  const [income, pots, lineItems, potSpendMap, lineItemSpendMap] = await Promise.all([
    Income.find({ userId, monthId: month._id }).sort({ createdAt: 1 }).lean(),
    Pot.find({ userId, monthId: month._id }).sort({ order: 1 }).lean(),
    LineItem.find({ userId, monthId: month._id }).sort({ order: 1 }).lean(),
    potsService.getSpendMapByMonth(userId, month._id),
    lineItemsService.getSpendMapByMonth(userId, month._id),
  ]);

  const lineItemsByPot = new Map();
  for (const li of lineItems) {
    const key = String(li.potId);
    const serialized = lineItemsService.serializeLineItem(
      li,
      lineItemSpendMap.get(String(li._id)) || 0
    );
    if (!lineItemsByPot.has(key)) lineItemsByPot.set(key, []);
    lineItemsByPot.get(key).push(serialized);
  }

  const totalIncome = income.reduce((sum, i) => sum + i.amount, 0);
  const totalBudgetLimit = pots.reduce((sum, p) => sum + p.budgetLimit, 0);

  return {
    _id: month._id,
    year: month.year,
    month: month.month,
    isLocked: month.isLocked,
    healthScore: month.healthScore,
    totalIncome,
    unallocatedIncome: totalIncome - totalBudgetLimit,
    income: income.map((i) => ({ _id: i._id, label: i.label, amount: i.amount })),
    pots: pots.map((pot) => ({
      ...potsService.serializePot(pot, potSpendMap.get(String(pot._id)) || 0),
      lineItems: lineItemsByPot.get(String(pot._id)) || [],
    })),
  };
}

// FR-08 — create a new empty month. Duplicate year+month for this user
// surfaces as a Mongo 11000 error via the unique compound index, mapped to
// 409 DUPLICATE by the global error handler.
async function createMonth(userId, { year, month }) {
  const created = await Month.create({ userId, year, month });
  return {
    _id: created._id,
    year: created.year,
    month: created.month,
    isLocked: created.isLocked,
  };
}

// FR-08, FR-09 — clone a month's pot/line-item structure into a new month.
async function cloneMonth(userId, sourceMonthId, targetPeriod) {
  const { targetMonth, potCount } = await monthService.cloneMonth(
    userId,
    sourceMonthId,
    targetPeriod
  );
  return {
    _id: targetMonth._id,
    year: targetMonth.year,
    month: targetMonth.month,
    isLocked: targetMonth.isLocked,
    potCount,
  };
}

// FR-08, FR-12 — lock a month, computing and storing its Budget Health Score.
async function lockMonth(userId, monthId) {
  const month = await monthService.lockMonth(userId, monthId);
  return { _id: month._id, isLocked: month.isLocked, healthScore: month.healthScore };
}

// FR-07 — submit rollover decisions for all pots with a surplus.
async function submitRollover(userId, monthId, decisions) {
  await monthService.submitRollover(userId, monthId, decisions);
}

module.exports = { listMonths, getMonthDetail, createMonth, cloneMonth, lockMonth, submitRollover };
