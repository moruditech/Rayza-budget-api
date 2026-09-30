const mongoose = require('mongoose');
const { LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const Month = require('../../models/Month.model');
const Income = require('../../models/Income.model');
const Pot = require('../../models/Pot.model');
const LineItem = require('../../models/LineItem.model');
const SpendLog = require('../../models/SpendLog.model');
const monthService = require('../../services/month.service');
const potsService = require('../pots/pots.service');
const { formatMonthLabel } = require('../../utils/dateUtils');

const DEFAULT_MONTHS_BACK = 6;

/** The user's last N months, oldest first (chronological, for charts). */
async function getRecentMonths(userId, monthsCount = DEFAULT_MONTHS_BACK) {
  const months = await Month.find({ userId })
    .sort({ year: -1, month: -1 })
    .limit(monthsCount)
    .lean();
  return months.reverse();
}

// FR-14 — Income vs Total Spend, month-over-month. "Total Spend" here sums
// every SpendLog entry (both INSTANT_SPEND transactions and
// SINKING_FUND_USED events) rather than just Pot.spentAmount's narrower
// INSTANT_SPEND-only definition — a sinking fund payout is real money
// leaving just as much as an instant spend is, and this report is meant to
// be the whole-picture cash-flow view, not a per-pot breakdown.
async function getIncomeVsSpend(userId, monthsCount) {
  const months = await getRecentMonths(userId, monthsCount);
  const monthIds = months.map((m) => m._id);
  const uid = new mongoose.Types.ObjectId(userId);

  const [incomeRows, spendRows] = await Promise.all([
    Income.aggregate([
      { $match: { userId: uid, monthId: { $in: monthIds } } },
      { $group: { _id: '$monthId', total: { $sum: '$amount' } } },
    ]),
    SpendLog.aggregate([
      {
        $match: {
          userId: uid,
          monthId: { $in: monthIds },
          // Fund-to-fund transfers just move money around — not spending.
          type: { $in: [SPEND_LOG_TYPES.INSTANT_SPEND, SPEND_LOG_TYPES.SINKING_FUND_USED] },
        },
      },
      { $group: { _id: '$monthId', total: { $sum: '$amount' } } },
    ]),
  ]);

  const incomeByMonth = new Map(incomeRows.map((row) => [String(row._id), row.total]));
  const spendByMonth = new Map(spendRows.map((row) => [String(row._id), row.total]));

  return months.map((m) => ({
    month: formatMonthLabel(m.year, m.month),
    income: incomeByMonth.get(String(m._id)) || 0,
    spent: spendByMonth.get(String(m._id)) || 0,
  }));
}

// FR-14 — Spending by Pot for one month. spentAmount here matches the
// Pot.spentAmount definition used everywhere else (INSTANT_SPEND only).
async function getSpendingByPot(userId, monthId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  const [pots, spentMap] = await Promise.all([
    Pot.find({ userId, monthId: month._id }).sort({ order: 1 }).lean(),
    potsService.getSpendMapByMonth(userId, month._id),
  ]);

  return pots.map((pot) => ({
    pot: pot.name,
    budgetLimit: pot.budgetLimit,
    spentAmount: spentMap.get(String(pot._id)) || 0,
  }));
}

/**
 * How each pot did this month compared with the previous calendar month.
 * Pots are separate documents in every month (a clone creates new ones), so the
 * same pot is matched across months by name, ignoring case and spacing.
 * "used" = spent + money put into sinking funds, the same as the pot card.
 */
async function getPotComparison(userId, monthId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  const prevYear = month.month === 1 ? month.year - 1 : month.year;
  const prevMonthNo = month.month === 1 ? 12 : month.month - 1;
  const previous = await Month.findOne({ userId, year: prevYear, month: prevMonthNo }).lean();

  const [currentPots, previousPots] = await Promise.all([
    potsService.listPots(userId, month._id),
    previous ? potsService.listPots(userId, previous._id) : Promise.resolve([]),
  ]);

  const snapshot = (p) => ({
    budget: p.budgetLimit,
    spent: p.spentAmount,
    committed: p.committedAmount,
    used: p.usedAmount,
    remaining: p.remaining,
  });
  const keyOf = (p) => p.name.trim().toLowerCase();
  const previousByName = new Map(previousPots.map((p) => [keyOf(p), p]));
  const seen = new Set();

  const rows = currentPots.map((p) => {
    const before = previousByName.get(keyOf(p));
    seen.add(keyOf(p));
    return buildComparisonRow(p.name, p.type, snapshot(p), before ? snapshot(before) : null);
  });
  // Pots that existed last month but not this one.
  previousPots
    .filter((p) => !seen.has(keyOf(p)))
    .forEach((p) => rows.push(buildComparisonRow(p.name, p.type, null, snapshot(p))));

  const sum = (list, field) => list.reduce((s, p) => s + p[field], 0);
  return {
    month: { year: month.year, month: month.month },
    previousMonth: previous ? { year: previous.year, month: previous.month } : null,
    totals: {
      current: sum(currentPots, 'usedAmount'),
      previous: previous ? sum(previousPots, 'usedAmount') : null,
    },
    pots: rows,
  };
}

function buildComparisonRow(name, type, current, previous) {
  const change = current && previous ? current.used - previous.used : null;
  return {
    name,
    type,
    current,
    previous,
    usedChange: change,
    usedChangePercent:
      change != null && previous.used > 0 ? Math.round((change / previous.used) * 100) : null,
  };
}

// FR-14 — Sinking Fund Progress over time. A cloned month creates a brand
// new LineItem document each time (a fresh _id every month), so there's no
// persistent "series id" linking the same ongoing goal across months in
// the data model. This groups by `name` as the best available proxy for
// "the same fund" — a reasonable assumption given fund names don't
// typically change month to month, but flagged since it's not an explicit
// identity the schema provides.
async function getSinkingFundProgress(userId, monthsCount) {
  const months = await getRecentMonths(userId, monthsCount);
  const monthIds = months.map((m) => m._id);
  const monthOrder = new Map(months.map((m, idx) => [String(m._id), idx]));
  const monthLabel = new Map(
    months.map((m) => [String(m._id), formatMonthLabel(m.year, m.month)])
  );

  const lineItems = await LineItem.find({
    userId,
    monthId: { $in: monthIds },
    type: LINE_ITEM_TYPES.SINKING_FUND,
  }).lean();

  const byName = new Map();
  for (const li of lineItems) {
    if (!byName.has(li.name)) byName.set(li.name, []);
    byName.get(li.name).push(li);
  }

  const result = [];
  for (const [name, items] of byName) {
    items.sort((a, b) => monthOrder.get(String(a.monthId)) - monthOrder.get(String(b.monthId)));
    const latest = items[items.length - 1];
    result.push({
      lineItem: name,
      target: latest.targetAmount,
      history: items.map((li) => ({
        month: monthLabel.get(String(li.monthId)),
        balance: li.accumulatedBalance,
      })),
    });
  }

  return result;
}

// FR-14 — Budget Health History. Only locked months carry a score (see the
// Backend Architecture doc: "Budget Health Score per locked month"), so
// unlocked months (healthScore: null) are excluded rather than shown as 0.
async function getHealthHistory(userId, monthsCount) {
  const months = await getRecentMonths(userId, monthsCount);
  return months
    .filter((m) => m.healthScore !== null && m.healthScore !== undefined)
    .map((m) => ({ month: formatMonthLabel(m.year, m.month), score: m.healthScore }));
}

// FR-14 — Category Breakdown for one month: % of income each pot TYPE
// (SPENDING/SAVING/INVESTMENT) consumes.
async function getCategoryBreakdown(userId, monthId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  const [pots, totalIncome] = await Promise.all([
    Pot.find({ userId, monthId: month._id }).lean(),
    monthService.getTotalIncome(userId, month._id),
  ]);

  const totalsByType = new Map();
  for (const pot of pots) {
    totalsByType.set(pot.type, (totalsByType.get(pot.type) || 0) + pot.budgetLimit);
  }

  return Array.from(totalsByType.entries()).map(([type, totalBudget]) => ({
    type,
    totalBudget,
    percentOfIncome: totalIncome > 0 ? Math.round((totalBudget / totalIncome) * 1000) / 10 : 0,
  }));
}

module.exports = {
  getIncomeVsSpend,
  getSpendingByPot,
  getPotComparison,
  getSinkingFundProgress,
  getHealthHistory,
  getCategoryBreakdown,
};
