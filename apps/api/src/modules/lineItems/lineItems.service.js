const mongoose = require('mongoose');
const { ERROR_CODES, LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const LineItem = require('../../models/LineItem.model');
const SpendLog = require('../../models/SpendLog.model');
const ApiError = require('../../utils/ApiError');
const monthService = require('../../services/month.service');
const sinkingFundService = require('../../services/sinkingFund.service');
const potsService = require('../pots/pots.service');
const { projectFund, goalProgress } = require('../../utils/futureValue');
const { dueDateFor } = require('../../utils/dateUtils');

// spentAmount (INSTANT_SPEND) is derived from SpendLog at read time; it
// never appears on a SINKING_FUND item, and target/accumulated/isReadyToUse/
// cycleHistory never appear on an INSTANT_SPEND item — mirrors the
// LineItem.model.js toJSON transform for API responses built off .lean()
// documents that don't go through that transform.
function serializeLineItem(li, spentAmount = 0) {
  const base = {
    _id: li._id,
    name: li.name,
    type: li.type,
    allocatedAmount: li.allocatedAmount,
    isRecurring: li.isRecurring,
    order: li.order,
    // Bills: dueDay is null for items that aren't bills.
    dueDay: li.dueDay ?? null,
    isPaid: li.isPaid ?? false,
    paidAt: li.paidAt ?? null,
  };

  if (li.type === LINE_ITEM_TYPES.INSTANT_SPEND) {
    return { ...base, spentAmount };
  }

  const progress =
    li.targetAmount > 0 ? Math.round((li.accumulatedBalance / li.targetAmount) * 1000) / 10 : 0;

  // Projection is null unless the fund has a fixed annual rate + target date.
  const projection = projectFund({
    balance: li.accumulatedBalance,
    monthlyContribution: li.monthlyContribution ?? li.allocatedAmount,
    annualInterestRate: li.annualInterestRate,
    targetDate: li.targetDate,
  });

  return {
    ...base,
    targetAmount: li.targetAmount,
    monthlyContribution: li.monthlyContribution,
    accumulatedBalance: li.accumulatedBalance,
    extraDeposited: li.extraDeposited ?? 0,
    isReadyToUse: li.isReadyToUse,
    progress,
    annualInterestRate: li.annualInterestRate ?? null,
    targetDate: li.targetDate ?? null,
    projection,
    projectedFutureValue: projection ? projection.projectedFutureValue : null,
    // Interest the bank has actually paid into this fund so far (all months).
    interestEarned: li.interestEarnedTotal ?? 0,
    // "Am I on track?" — needs a target amount and a goal date.
    progressCheck: goalProgress({
      balance: li.accumulatedBalance,
      monthlyContribution: li.monthlyContribution ?? li.allocatedAmount,
      targetAmount: li.targetAmount,
      annualInterestRate: li.annualInterestRate,
      targetDate: li.targetDate,
    }),
  };
}

/** lineItemId -> spentAmount for every INSTANT_SPEND item in a month. `monthId` must be an ObjectId. */
async function getSpendMapByMonth(userId, monthId) {
  const rows = await SpendLog.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        monthId,
        type: SPEND_LOG_TYPES.INSTANT_SPEND,
      },
    },
    { $group: { _id: '$lineItemId', total: { $sum: '$amount' } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.total]));
}

/** spentAmount for a single line item. `lineItemId` must be an ObjectId. */
async function getLineItemSpentAmount(userId, lineItemId) {
  const rows = await SpendLog.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        lineItemId,
        type: SPEND_LOG_TYPES.INSTANT_SPEND,
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return rows[0]?.total || 0;
}

/** Sum of allocatedAmount for every line item in a pot, optionally excluding one. */
async function getTotalAllocated(userId, potId, { excludeLineItemId } = {}) {
  const match = { userId: new mongoose.Types.ObjectId(userId), potId };
  if (excludeLineItemId) match._id = { $ne: excludeLineItemId };
  const rows = await LineItem.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$allocatedAmount' } } },
  ]);
  return rows[0]?.total || 0;
}

/** Fetches a line item scoped to user + pot, or throws 404 NOT_FOUND. Exported for transactions.service.js. */
async function getLineItemOrThrow(userId, potId, lineItemId) {
  const lineItem = await LineItem.findOne({ _id: lineItemId, userId, potId });
  if (!lineItem) {
    throw new ApiError(404, 'Line item not found', null, ERROR_CODES.NOT_FOUND);
  }
  return lineItem;
}

function assertInterestFields(annualInterestRate, targetDate) {
  if (annualInterestRate != null && !targetDate) {
    throw new ApiError(
      422,
      'targetDate is required when annualInterestRate is set',
      null,
      ERROR_CODES.VALIDATION_ERROR
    );
  }
}

function assertTypeFieldsOnCreate(data) {
  if (data.type === LINE_ITEM_TYPES.INSTANT_SPEND) {
    if (
      data.targetAmount !== undefined ||
      data.monthlyContribution !== undefined ||
      data.annualInterestRate != null ||
      data.targetDate != null
    ) {
      throw new ApiError(
        400,
        'targetAmount and monthlyContribution are not valid for INSTANT_SPEND line items',
        null,
        ERROR_CODES.INVALID_FIELDS_FOR_TYPE
      );
    }
  } else if (data.type === LINE_ITEM_TYPES.SINKING_FUND) {
    if (data.targetAmount === undefined) {
      throw new ApiError(
        400,
        'targetAmount is required for SINKING_FUND line items',
        null,
        ERROR_CODES.SINKING_FUND_FIELDS
      );
    }
    assertInterestFields(data.annualInterestRate, data.targetDate);
  }
}

// FR-04 — get all line items for a pot.
async function listLineItems(userId, monthId, potId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  const pot = await potsService.getPotOrThrow(userId, month._id, potId);

  const [lineItems, spentMap] = await Promise.all([
    LineItem.find({ userId, potId: pot._id }).sort({ order: 1 }).lean(),
    getSpendMapByMonth(userId, month._id),
  ]);

  return lineItems.map((li) => serializeLineItem(li, spentMap.get(String(li._id)) || 0));
}

// FR-04 — create a line item. Sum of allocatedAmount must not exceed the
// parent pot's Budget Limit; type-specific fields are enforced above.
async function createLineItem(userId, monthId, potId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);

  assertTypeFieldsOnCreate(data);

  const currentAllocated = await getTotalAllocated(userId, pot._id);
  if (currentAllocated + data.allocatedAmount > pot.budgetLimit) {
    throw new ApiError(
      400,
      'Sum of line item allocations cannot exceed the pot Budget Limit',
      null,
      ERROR_CODES.ALLOCATION_EXCEEDED
    );
  }

  const isSinkingFund = data.type === LINE_ITEM_TYPES.SINKING_FUND;

  const lineItem = await LineItem.create({
    userId,
    potId: pot._id,
    monthId: month._id,
    name: data.name,
    type: data.type,
    allocatedAmount: data.allocatedAmount,
    isRecurring: data.isRecurring ?? false,
    order: data.order ?? 0,
    targetAmount: isSinkingFund ? data.targetAmount : undefined,
    // The allocation is the monthly deposit unless a separate figure is given.
    monthlyContribution: isSinkingFund
      ? (data.monthlyContribution ?? data.allocatedAmount)
      : undefined,
    // Auto-deposit: the allocation goes into the fund straight away.
    accumulatedBalance: isSinkingFund ? data.allocatedAmount : 0,
    annualInterestRate: isSinkingFund ? (data.annualInterestRate ?? null) : null,
    targetDate: isSinkingFund ? (data.targetDate ?? null) : null,
    dueDay: data.dueDay ?? null,
  });

  return serializeLineItem(lineItem.toObject(), 0);
}

// FR-04 — update a line item.
async function updateLineItem(userId, monthId, potId, lineItemId, updates) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);

  const lineItem = await getLineItemOrThrow(userId, pot._id, lineItemId);

  if (
    lineItem.type === LINE_ITEM_TYPES.INSTANT_SPEND &&
    (updates.targetAmount !== undefined ||
      updates.monthlyContribution !== undefined ||
      updates.annualInterestRate != null ||
      updates.targetDate != null)
  ) {
    throw new ApiError(
      400,
      'targetAmount and monthlyContribution are not valid for INSTANT_SPEND line items',
      null,
      ERROR_CODES.INVALID_FIELDS_FOR_TYPE
    );
  }

  if (
    updates.allocatedAmount !== undefined &&
    updates.allocatedAmount !== lineItem.allocatedAmount
  ) {
    const otherAllocated = await getTotalAllocated(userId, pot._id, {
      excludeLineItemId: lineItem._id,
    });
    if (otherAllocated + updates.allocatedAmount > pot.budgetLimit) {
      throw new ApiError(
        400,
        'Updated allocation would exceed the pot Budget Limit',
        null,
        ERROR_CODES.ALLOCATION_EXCEEDED
      );
    }
  }

  if (lineItem.type === LINE_ITEM_TYPES.SINKING_FUND) {
    const nextRate =
      updates.annualInterestRate !== undefined
        ? updates.annualInterestRate
        : lineItem.annualInterestRate;
    const nextDate = updates.targetDate !== undefined ? updates.targetDate : lineItem.targetDate;
    assertInterestFields(nextRate, nextDate);

    // Changing the allocation changes what has been deposited into the fund.
    if (
      updates.allocatedAmount !== undefined &&
      updates.allocatedAmount !== lineItem.allocatedAmount
    ) {
      const delta = updates.allocatedAmount - lineItem.allocatedAmount;
      lineItem.accumulatedBalance = Math.max(
        0,
        Math.round((lineItem.accumulatedBalance + delta) * 100) / 100
      );
      // Keep the monthly contribution in step unless it was set separately.
      if (
        updates.monthlyContribution === undefined &&
        lineItem.monthlyContribution === lineItem.allocatedAmount
      ) {
        lineItem.monthlyContribution = updates.allocatedAmount;
      }
    }
  }

  // Removing the due day means it is no longer a bill, so drop its paid state.
  if (updates.dueDay === null) {
    lineItem.isPaid = false;
    lineItem.paidAt = null;
  }

  Object.assign(lineItem, updates);
  // Triggers the LineItem pre-save hook, which recomputes isReadyToUse.
  await lineItem.save();

  const spentAmount =
    lineItem.type === LINE_ITEM_TYPES.INSTANT_SPEND
      ? await getLineItemSpentAmount(userId, lineItem._id)
      : 0;

  return serializeLineItem(lineItem.toObject(), spentAmount);
}

// FR-04 — delete a line item. Cascades to its spend log entries — see the
// same reasoning as pot deletion in pots.service.js.
async function deleteLineItem(userId, monthId, potId, lineItemId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);

  const lineItem = await getLineItemOrThrow(userId, pot._id, lineItemId);

  await SpendLog.deleteMany({ userId, lineItemId: lineItem._id });
  await lineItem.deleteOne();
}

function serializeMarkUsedResult(li) {
  return {
    _id: li._id,
    accumulatedBalance: li.accumulatedBalance,
    isReadyToUse: li.isReadyToUse,
    cycleHistory: li.cycleHistory,
  };
}

// FR-06 — Mark as Used. Gated on isReadyToUse; delegates the actual
// balance reset + SpendLog write to sinkingFund.service.js.
async function markLineItem(userId, monthId, potId, lineItemId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  const lineItem = await getLineItemOrThrow(userId, pot._id, lineItemId);

  await sinkingFundService.markLineItemUsed(userId, lineItem, data);

  return serializeMarkUsedResult(lineItem);
}

// Withdraw from a sinking fund at any time (before or after its target),
// e.g. to buy something or fund another goal. Reduces the accumulated
// balance and writes a SINKING_FUND_USED spend log entry.
async function withdrawLineItem(userId, monthId, potId, lineItemId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  const lineItem = await getLineItemOrThrow(userId, pot._id, lineItemId);

  await sinkingFundService.withdrawFromFund(userId, lineItem, data);

  return serializeLineItem(lineItem.toObject(), 0);
}

// Invest what is left in the pot into an existing sinking fund, instead of
// having to create a new line item. The amount must fit in the pot's remaining
// budget (budget + rollover - spent - already put into funds).
async function depositLineItem(userId, monthId, potId, lineItemId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  const lineItem = await getLineItemOrThrow(userId, pot._id, lineItemId);

  const before = await potsService.getPotTotals(userId, pot);
  if (data.amount > before.remaining) {
    throw new ApiError(
      400,
      'Amount exceeds what is left in this pot',
      null,
      ERROR_CODES.ALLOCATION_EXCEEDED
    );
  }

  await sinkingFundService.depositToFund(userId, lineItem, data);

  const totals = await potsService.getPotTotals(userId, pot);
  return {
    lineItem: serializeLineItem(lineItem.toObject(), 0),
    pot: { _id: pot._id, ...totals, surplus: totals.remaining },
  };
}

// Log interest the bank actually paid into a fund and compare it with what the
// fund's rate predicted.
async function recordInterestLineItem(userId, monthId, potId, lineItemId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  const lineItem = await getLineItemOrThrow(userId, pot._id, lineItemId);

  await sinkingFundService.recordInterest(userId, lineItem, data);

  return serializeLineItem(lineItem.toObject(), 0);
}

// "Mark paid" / "Mark unpaid" on a bill (an item with a due day). Purely a
// marker the person controls — it does not create a spend or move money.
async function markLineItemPaid(userId, monthId, potId, lineItemId, { paid }) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  const lineItem = await getLineItemOrThrow(userId, pot._id, lineItemId);

  if (lineItem.dueDay == null) {
    throw new ApiError(
      422,
      'Set a due day on this item before marking it paid',
      null,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  lineItem.isPaid = paid;
  lineItem.paidAt = paid ? new Date() : null;
  await lineItem.save();

  return {
    ...serializeLineItem(lineItem.toObject(), 0),
    dueDate: dueDateFor(month.year, month.month, lineItem.dueDay),
  };
}

module.exports = {
  serializeLineItem,
  markLineItemPaid,
  recordInterestLineItem,
  depositLineItem,
  withdrawLineItem,
  getSpendMapByMonth,
  getLineItemSpentAmount,
  getLineItemOrThrow,
  listLineItems,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  markLineItem,
};
