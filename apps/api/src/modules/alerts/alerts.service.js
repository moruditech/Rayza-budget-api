const { ALERT_TYPES, LINE_ITEM_TYPES } = require('@budget-app/shared');
const Month = require('../../models/Month.model');
const Pot = require('../../models/Pot.model');
const LineItem = require('../../models/LineItem.model');
const SpendLog = require('../../models/SpendLog.model');
const monthService = require('../../services/month.service');
const potsService = require('../pots/pots.service');
const {
  daysSince,
  isAfterDayOfMonth,
  isMonthReadyToLock,
  getMonthName,
  dueDateFor,
  daysBetweenUtc,
} = require('../../utils/dateUtils');

const APPROACHING_THRESHOLD = 0.8;
const STALE_DAYS_THRESHOLD = 5;
const UNALLOCATED_GRACE_DAY = 5;
// A month is "ready to lock" during its last 3 days and at any point after.
const LOCK_READY_DAYS_BEFORE_END = 3;
// Unpaid bills start showing up this many days before they are due.
const BILL_REMINDER_DAYS = 3;

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

/**
 * "<Month> is ready to lock" — one alert for every unlocked month that is in
 * its last days or already over. Independent of the current-month alerts
 * below, so a month you forgot to lock keeps nagging after it has ended.
 */
async function evaluateLockAlerts(userId) {
  const unlocked = await Month.find({ userId, isLocked: false }).sort({ year: 1, month: 1 }).lean();
  return unlocked
    .filter((m) => isMonthReadyToLock(m.year, m.month, LOCK_READY_DAYS_BEFORE_END))
    .map((m) => ({
      type: ALERT_TYPES.MONTH_READY_TO_LOCK,
      message: `${getMonthName(m.month)} is ready to lock`,
      meta: { monthId: m._id, year: m.year, month: m.month },
    }));
}

function dayWord(n) {
  return n === 1 ? '1 day' : `${n} days`;
}

/**
 * Unpaid bills (items with a due day) of the current month that are due
 * within the next few days, due today, or already overdue. The person ends the
 * reminder themselves with "Mark paid".
 */
async function evaluateBillAlerts(userId, month, now = new Date()) {
  if (month.isLocked) return [];

  const bills = await LineItem.find({
    userId,
    monthId: month._id,
    dueDay: { $ne: null },
    isPaid: false,
  }).lean();

  const alerts = [];
  for (const bill of bills) {
    const due = dueDateFor(month.year, month.month, bill.dueDay);
    const days = daysBetweenUtc(now, due); // negative = overdue
    if (days > BILL_REMINDER_DAYS) continue;

    const meta = {
      monthId: month._id,
      potId: bill.potId,
      lineItemId: bill._id,
      dueDate: due,
      daysUntilDue: days,
    };

    if (days < 0) {
      alerts.push({
        type: ALERT_TYPES.BILL_OVERDUE,
        message: `${bill.name} was due ${dayWord(-days)} ago`,
        meta,
      });
    } else {
      alerts.push({
        type: ALERT_TYPES.BILL_DUE,
        message:
          days === 0
            ? `${bill.name} is due today`
            : days === 1
              ? `${bill.name} is due tomorrow`
              : `${bill.name} is due in ${dayWord(days)}`,
        meta,
      });
    }
  }

  // Most urgent first: longest overdue, then soonest due.
  return alerts.sort((a, b) => a.meta.daysUntilDue - b.meta.daysUntilDue);
}

// FR-13 — evaluates all alert conditions on demand.
async function evaluateAlerts(userId) {
  const lockAlerts = await evaluateLockAlerts(userId);
  const month = await getCurrentCalendarMonth(userId);
  if (!month) return lockAlerts;

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

  const alerts = [...lockAlerts, ...(await evaluateBillAlerts(userId, month))];

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
