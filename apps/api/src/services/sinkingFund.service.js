const { ERROR_CODES, LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const SpendLog = require('../models/SpendLog.model');
const ApiError = require('../utils/ApiError');

/**
 * "Each month the Monthly Contribution is added to the Accumulated
 * Balance" (FR-06). There's no separate "add contribution" endpoint
 * anywhere in the API Contract, so this is applied here, at the one place
 * a new month's opening state gets computed: month.service.js's clone().
 * `sourceLineItem` is a plain object (from .lean()).
 */
function carryForwardBalance(sourceLineItem) {
  if (sourceLineItem.type !== LINE_ITEM_TYPES.SINKING_FUND) {
    return { accumulatedBalance: 0 };
  }
  const contribution = sourceLineItem.monthlyContribution || 0;
  return { accumulatedBalance: (sourceLineItem.accumulatedBalance || 0) + contribution };
}

/**
 * FR-06 — Mark as Used. Validates the line item is a ready SINKING_FUND,
 * writes the SpendLog entry, reduces (or zeroes) the balance, and appends
 * to cycleHistory. Mutates and saves `lineItem` (a live Mongoose document)
 * in place; the caller is responsible for fetching/scoping it.
 */
async function markLineItemUsed(userId, lineItem, { amount, note }) {
  if (lineItem.type !== LINE_ITEM_TYPES.SINKING_FUND) {
    throw new ApiError(
      400,
      'mark-used is only valid on SINKING_FUND line items',
      null,
      ERROR_CODES.WRONG_TYPE
    );
  }

  if (!lineItem.isReadyToUse) {
    throw new ApiError(
      400,
      'This sinking fund has not reached its target yet',
      null,
      ERROR_CODES.NOT_READY
    );
  }

  if (amount > lineItem.accumulatedBalance) {
    throw new ApiError(
      400,
      'amount cannot exceed the accumulated balance',
      null,
      ERROR_CODES.AMOUNT_EXCEEDS_BALANCE
    );
  }

  const usedAt = new Date();

  await SpendLog.create({
    userId,
    monthId: lineItem.monthId,
    potId: lineItem.potId,
    lineItemId: lineItem._id,
    type: SPEND_LOG_TYPES.SINKING_FUND_USED,
    amount,
    date: usedAt,
    note: note ?? null,
  });

  lineItem.accumulatedBalance -= amount;
  lineItem.cycleHistory.push({ usedAt, amount, note: note ?? null });
  // isReadyToUse is recomputed by the LineItem pre-save hook.
  await lineItem.save();

  return lineItem;
}

module.exports = { carryForwardBalance, markLineItemUsed };
