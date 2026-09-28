const mongoose = require('mongoose');
const { SPEND_LOG_TYPES } = require('@budget-app/shared');
const SpendLog = require('../../models/SpendLog.model');
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

const FUND_ACTIVITY_TYPES = [
  SPEND_LOG_TYPES.SINKING_FUND_USED,
  SPEND_LOG_TYPES.TRANSFER_IN,
  SPEND_LOG_TYPES.TRANSFER_OUT,
];
const MAX_ACTIVITY_PER_FUND = 20;

/**
 * Per-fund history (withdrawals, money received, money moved out) plus each
 * pot's received/sent totals. The other side of a transfer is found through
 * the shared transferId, so entries made before this feature existed also
 * show where the money came from / went to.
 */
function buildFundActivity(logs, lineItems, pots) {
  const itemById = new Map(lineItems.map((li) => [String(li._id), li]));
  const potById = new Map(pots.map((p) => [String(p._id), p]));

  const byTransfer = new Map();
  for (const log of logs) {
    if (!log.transferId) continue;
    const key = String(log.transferId);
    if (!byTransfer.has(key)) byTransfer.set(key, []);
    byTransfer.get(key).push(log);
  }

  const activityByItem = new Map();
  const transfersByPot = new Map();

  for (const log of logs) {
    let counterparty = null;
    if (log.transferId) {
      const other = (byTransfer.get(String(log.transferId)) || []).find(
        (l) => String(l._id) !== String(log._id)
      );
      if (other) {
        counterparty = {
          lineItemName: itemById.get(String(other.lineItemId))?.name ?? null,
          potName: potById.get(String(other.potId))?.name ?? null,
        };
      }
    }

    const itemKey = String(log.lineItemId);
    if (!activityByItem.has(itemKey)) activityByItem.set(itemKey, []);
    const list = activityByItem.get(itemKey);
    if (list.length < MAX_ACTIVITY_PER_FUND) {
      list.push({
        _id: log._id,
        type: log.type,
        amount: log.amount,
        date: log.date,
        note: log.note,
        counterparty,
      });
    }

    if (log.type !== SPEND_LOG_TYPES.SINKING_FUND_USED) {
      const potKey = String(log.potId);
      const totals = transfersByPot.get(potKey) || { received: 0, sent: 0 };
      if (log.type === SPEND_LOG_TYPES.TRANSFER_IN) totals.received += log.amount;
      else totals.sent += log.amount;
      transfersByPot.set(potKey, totals);
    }
  }

  return { activityByItem, transfersByPot };
}

// FR-08 — get one month with full detail: income, pots, and each pot's
// line items nested, all computed fields included.
async function getMonthDetail(userId, monthId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);

  const [income, pots, lineItems, potSpendMap, lineItemSpendMap, potCommittedMap, fundLogs] = await Promise.all([
    Income.find({ userId, monthId: month._id }).sort({ createdAt: 1 }).lean(),
    Pot.find({ userId, monthId: month._id }).sort({ order: 1 }).lean(),
    LineItem.find({ userId, monthId: month._id }).sort({ order: 1 }).lean(),
    potsService.getSpendMapByMonth(userId, month._id),
    lineItemsService.getSpendMapByMonth(userId, month._id),
    potsService.getCommittedMapByMonth(userId, month._id),
    SpendLog.find({ userId, monthId: month._id, type: { $in: FUND_ACTIVITY_TYPES } })
      .sort({ date: -1, _id: -1 })
      .lean(),
  ]);

  const { activityByItem, transfersByPot } = buildFundActivity(fundLogs, lineItems, pots);

  const lineItemsByPot = new Map();
  for (const li of lineItems) {
    const key = String(li.potId);
    const serialized = lineItemsService.serializeLineItem(
      li,
      lineItemSpendMap.get(String(li._id)) || 0
    );
    if (li.type === 'SINKING_FUND') {
      serialized.activity = activityByItem.get(String(li._id)) || [];
    }
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
      ...potsService.serializePot(
        pot,
        potSpendMap.get(String(pot._id)) || 0,
        potCommittedMap.get(String(pot._id)) || 0
      ),
      transferredIn: transfersByPot.get(String(pot._id))?.received || 0,
      transferredOut: transfersByPot.get(String(pot._id))?.sent || 0,
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
