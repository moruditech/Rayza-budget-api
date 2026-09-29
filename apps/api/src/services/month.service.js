const mongoose = require('mongoose');
const { ERROR_CODES, LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const Month = require('../models/Month.model');
const Income = require('../models/Income.model');
const Pot = require('../models/Pot.model');
const LineItem = require('../models/LineItem.model');
const SpendLog = require('../models/SpendLog.model');
const ApiError = require('../utils/ApiError');
const healthService = require('./health.service');
const sinkingFundService = require('./sinkingFund.service');

/** Fetches a month scoped to the user, or throws 404 NOT_FOUND. */
async function getMonthOrThrow(userId, monthId) {
  const month = await Month.findOne({ _id: monthId, userId });
  if (!month) {
    throw new ApiError(404, 'Month not found', null, ERROR_CODES.NOT_FOUND);
  }
  return month;
}

/**
 * Throws 400 MONTH_LOCKED if the given month is locked. Called by every
 * write path in income/pots/lineItems (and, from Phase 4, transactions) —
 * see "Business Rule Enforcement Summary" in the Backend Architecture doc.
 */
function assertMonthUnlocked(month) {
  if (month.isLocked) {
    throw new ApiError(
      400,
      'This month is locked and cannot be modified',
      null,
      ERROR_CODES.MONTH_LOCKED
    );
  }
}

/** Sum of all Income.amount for a month. `monthId` must be an ObjectId (e.g. month._id). */
async function getTotalIncome(userId, monthId) {
  const rows = await Income.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), monthId } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return rows[0]?.total || 0;
}

/**
 * Sum of all Pot.budgetLimit for a month, optionally excluding one pot —
 * used when validating an update to that pot's own budgetLimit.
 */
async function getTotalPotBudgetLimits(userId, monthId, { excludePotId } = {}) {
  const match = { userId: new mongoose.Types.ObjectId(userId), monthId };
  if (excludePotId) match._id = { $ne: excludePotId };
  const rows = await Pot.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$budgetLimit' } } },
  ]);
  return rows[0]?.total || 0;
}

/**
 * potId -> spentAmount for a month, duplicated here (rather than reusing
 * pots.service.js's identical helper) to avoid a circular require —
 * pots.service.js itself requires this file for getMonthOrThrow /
 * assertMonthUnlocked, so this file can't require pots.service.js back.
 * `monthId` must be an ObjectId.
 */
async function getPotSpendMapForClone(userId, monthId) {
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

/**
 * FR-08 — clones a month's pot and line item structure into a new month.
 *
 * - Pots are recreated as-is with rolloverBalance starting at 0, then each
 *   source pot's recorded rollover decision (default RESET if none was
 *   ever submitted) is applied to compute the new pot's opening balance.
 *   This deliberately bypasses pots.service.js's BUDGET_EXCEEDED check:
 *   the target month has no income yet (income is never cloned — the API
 *   Contract only ever mentions cloning "pot and line item structure"),
 *   so that check would reject every clone outright.
 * - SINKING_FUND line items always carry forward (a savings goal doesn't
 *   depend on isRecurring); INSTANT_SPEND items only carry forward when
 *   isRecurring is true (FR-09). Spent amounts are never copied — no
 *   SpendLog rows are cloned, so every carried-over item starts at zero
 *   spend for the new month, per FR-08 ("with zero spending").
 */
async function cloneMonth(userId, sourceMonthId, { year, month }) {
  const sourceMonth = await getMonthOrThrow(userId, sourceMonthId);

  // Uniqueness of { userId, year, month } is enforced by Month's compound
  // index — a clash surfaces as a Mongo 11000 error, mapped to 409
  // DUPLICATE by the global error handler, matching the API Contract.
  const targetMonth = await Month.create({ userId, year, month });

  const [sourcePots, sourceLineItems, spentByPot] = await Promise.all([
    Pot.find({ userId, monthId: sourceMonth._id }).lean(),
    LineItem.find({ userId, monthId: sourceMonth._id }).lean(),
    getPotSpendMapForClone(userId, sourceMonth._id),
  ]);

  const committedByPot = new Map();
  for (const li of sourceLineItems) {
    if (li.type !== LINE_ITEM_TYPES.SINKING_FUND) continue;
    const key = String(li.potId);
    committedByPot.set(key, (committedByPot.get(key) || 0) + li.allocatedAmount + (li.extraDeposited || 0));
  }

  const decisionsByOldPotId = new Map(
    (sourceMonth.rolloverDecisions || []).map((d) => [String(d.potId), d])
  );

  // Pass 1 — recreate every pot, rolloverBalance starts at 0.
  const oldToNewPotId = new Map();
  for (const sourcePot of sourcePots) {
    // eslint-disable-next-line no-await-in-loop -- clone runs infrequently
    // (once per month) over a small number of pots; sequential keeps the
    // logic simple and easy to follow.
    const newPot = await Pot.create({
      userId,
      monthId: targetMonth._id,
      name: sourcePot.name,
      icon: sourcePot.icon,
      colour: sourcePot.colour,
      type: sourcePot.type,
      budgetLimit: sourcePot.budgetLimit,
      rolloverBalance: 0,
      order: sourcePot.order,
    });
    oldToNewPotId.set(String(sourcePot._id), newPot._id);
  }

  // Pass 2 — apply each source pot's rollover decision to the new pot(s).
  for (const sourcePot of sourcePots) {
    const decision = decisionsByOldPotId.get(String(sourcePot._id));
    const action = decision?.action || 'RESET';
    if (action === 'RESET') continue;

    const spent = spentByPot.get(String(sourcePot._id)) || 0;
    // Money allocated to sinking funds has left the pot (it sits in the
    // fund), so it is not surplus that can be rolled over.
    const committed = committedByPot.get(String(sourcePot._id)) || 0;
    const surplus = sourcePot.budgetLimit + sourcePot.rolloverBalance - spent - committed;
    if (surplus <= 0) continue;

    const beneficiaryOldPotId =
      action === 'SWEEP' && decision.targetPotId ? decision.targetPotId : sourcePot._id;
    const newBeneficiaryPotId = oldToNewPotId.get(String(beneficiaryOldPotId));
    // A SWEEP target that no longer exists (deleted since the decision was
    // recorded) has nowhere to go — skip it rather than fail the whole clone.
    if (!newBeneficiaryPotId) continue;

    // eslint-disable-next-line no-await-in-loop
    await Pot.updateOne({ _id: newBeneficiaryPotId, userId }, { $inc: { rolloverBalance: surplus } });
  }

  // Pass 3 — line items.
  for (const sourceLineItem of sourceLineItems) {
    const newPotId = oldToNewPotId.get(String(sourceLineItem.potId));
    if (!newPotId) continue;

    const shouldClone =
      sourceLineItem.type === LINE_ITEM_TYPES.SINKING_FUND || sourceLineItem.isRecurring;
    if (!shouldClone) continue;

    const carried =
      sourceLineItem.type === LINE_ITEM_TYPES.SINKING_FUND
        ? sinkingFundService.carryForwardBalance(sourceLineItem)
        : { accumulatedBalance: 0 };

    // eslint-disable-next-line no-await-in-loop
    await LineItem.create({
      userId,
      potId: newPotId,
      monthId: targetMonth._id,
      name: sourceLineItem.name,
      type: sourceLineItem.type,
      allocatedAmount: sourceLineItem.allocatedAmount,
      isRecurring: sourceLineItem.isRecurring,
      order: sourceLineItem.order,
      targetAmount: sourceLineItem.targetAmount,
      monthlyContribution: sourceLineItem.monthlyContribution,
      accumulatedBalance: carried.accumulatedBalance,
      interestEarnedTotal: carried.interestEarnedTotal,
      annualInterestRate: sourceLineItem.annualInterestRate ?? null,
      targetDate: sourceLineItem.targetDate ?? null,
      cycleHistory: sourceLineItem.cycleHistory || [],
    });
  }

  return { targetMonth, potCount: oldToNewPotId.size };
}

/**
 * FR-08, FR-12 — locks a month permanently and computes/stores its Budget
 * Health Score. healthService is a leaf service (only touches models
 * directly) specifically so this file can call it without a circular
 * require back into month.service.js.
 */
async function lockMonth(userId, monthId) {
  const month = await getMonthOrThrow(userId, monthId);
  if (month.isLocked) {
    throw new ApiError(400, 'Month is already locked', null, ERROR_CODES.ALREADY_LOCKED);
  }

  const healthScore = await healthService.computeHealthScore(userId, month._id);

  month.isLocked = true;
  month.healthScore = healthScore;
  await month.save();

  return month;
}

/**
 * FR-07 — submits rollover decisions for pots in a month. Must be called
 * before the month is locked (assertMonthUnlocked reuses the same
 * MONTH_LOCKED code the docs use for this case too).
 */
async function submitRollover(userId, monthId, decisions) {
  const month = await getMonthOrThrow(userId, monthId);
  assertMonthUnlocked(month);

  const pots = await Pot.find({ userId, monthId: month._id }).select('_id').lean();
  const potIds = new Set(pots.map((pot) => String(pot._id)));

  for (const decision of decisions) {
    if (!potIds.has(String(decision.potId))) {
      throw new ApiError(404, 'Pot not found in this month', null, ERROR_CODES.NOT_FOUND);
    }
    if (decision.action === 'SWEEP' && !potIds.has(String(decision.targetPotId))) {
      throw new ApiError(
        400,
        'targetPotId must belong to the same month',
        null,
        ERROR_CODES.INVALID_TARGET_POT
      );
    }
  }

  month.rolloverDecisions = decisions.map((decision) => ({
    potId: decision.potId,
    action: decision.action,
    targetPotId: decision.action === 'SWEEP' ? decision.targetPotId : null,
  }));
  await month.save();

  return month;
}

module.exports = {
  getMonthOrThrow,
  assertMonthUnlocked,
  getTotalIncome,
  getTotalPotBudgetLimits,
  cloneMonth,
  lockMonth,
  submitRollover,
};
