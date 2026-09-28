const { ALERT_TYPES, LINE_ITEM_TYPES } = require('@budget-app/shared');
const Month = require('../../models/Month.model');
const Pot = require('../../models/Pot.model');
const LineItem = require('../../models/LineItem.model');
const SpendLog = require('../../models/SpendLog.model');
const monthService = require('../../services/month.service');
const potsService = require('../pots/pots.service');
const { daysSince, isAfterDayOfMonth } = require('../../utils/dateUtils');

const APPROACHING_THRESHOLD = 0.8;
const STALE_DAYS_THRESHOLD = 5;
const UNALLOCATED_GRACE_DAY = 5;

/**
 * FR-13's GET /alerts has no query params in the API Contract, and the
 * data model has no server-side "active month" concept (that's client-only
 * state — see the frontend's monthStore.js). So "the current state of the
 * user's active month" is resolved here from the real calendar date (UTC)
 * instead. If the user hasn't created a Month for the current calendar
 * year/month, there's nothing to evaluate.
 */
async function getCurrentCalendarMonth(userId) {
  const now = new Date();
  return Month.findOne({
    userId,
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
}

// FR-13 — evaluates all 5 alert conditions on demand.
async function evaluateAlerts(userId) {
  const month = await getCurrentCalendarMonth(userId);
  if (!month) return [];

  const [pots, spentByPot, committedByPot, readySinkingFunds, totalIncome, totalBudgetLimit, latestSpend] =
    await Promise.all([
      Pot.find({ userId, monthId: month._id }).lean(),
      potsService.getSpendMapByMonth(userId, month._id),
      potsService.getCommittedMapByMonth(userId, month._id),
      LineItem.find({
        userId,
        monthId: month._id,
        type: LINE_ITEM_TYPES.SINKING_FUND,
        isReadyToUse: true,
      })
        .populate('potId', 'name')
        .lean(),
      monthService.getTotalIncome(userId, month._id),
      monthService.getTotalPotBudgetLimits(userId, month._id),
      SpendLog.findOne({ userId, monthId: month._id }).sort({ date: -1 }).lean(),
    ]);

  const alerts = [];

  // "Pot Spent Amount >= 80% of Budget Limit" / "> Budget Limit"
  for (const pot of pots) {
    const limit = pot.budgetLimit + pot.rolloverBalance;
    if (limit <= 0) continue;
    // Money allocated to sinking funds is used budget even though it isn't spent.
    const spent = (spentByPot.get(String(pot._id)) || 0) + (committedByPot.get(String(pot._id)) || 0);
    const percentUsed = Math.round((spent / limit) * 1000) / 10;

    if (spent > limit) {
      alerts.push({
        type: ALERT_TYPES.POT_OVER_BUDGET,
        message: `${pot.name} is over its budget`,
        pot: { _id: pot._id, name: pot.name },
        meta: { percentUsed },
      });
    } else if (spent >= limit * APPROACHING_THRESHOLD) {
      alerts.push({
        type: ALERT_TYPES.POT_APPROACHING_LIMIT,
        message: `${pot.name} is at ${percentUsed}% of its budget`,
        pot: { _id: pot._id, name: pot.name },
        meta: { percentUsed },
      });
    }
  }

  // "Sinking fund isReadyToUse: true"
  for (const li of readySinkingFunds) {
    alerts.push({
      type: ALERT_TYPES.SINKING_FUND_READY,
      message: `${li.name} sinking fund has reached its target`,
      pot: li.potId ? { _id: li.potId._id, name: li.potId.name } : null,
      lineItem: { _id: li._id, name: li.name },
    });
  }

  // "Unallocated Income > 0 after the 5th of the month"
  const unallocatedAmount = totalIncome - totalBudgetLimit;
  if (unallocatedAmount > 0 && isAfterDayOfMonth(UNALLOCATED_GRACE_DAY)) {
    alerts.push({
      type: ALERT_TYPES.UNALLOCATED_INCOME,
      message: `${unallocatedAmount} is still unallocated this month`,
      meta: { unallocatedAmount },
    });
  }

  // "No transaction logged in 5+ days" — falls back to the month's
  // creation date when nothing has ever been logged, so a brand-new month
  // isn't immediately flagged as stale.
  const referenceDate = latestSpend ? latestSpend.date : month.createdAt;
  const daysSinceLastSpend = daysSince(referenceDate);
  if (daysSinceLastSpend >= STALE_DAYS_THRESHOLD) {
    alerts.push({
      type: ALERT_TYPES.STALE_BUDGET,
      message: 'You have not logged any spending in 5 days — is your budget up to date?',
      meta: { daysSinceLastSpend },
    });
  }

  return alerts;
}

module.exports = { evaluateAlerts };
