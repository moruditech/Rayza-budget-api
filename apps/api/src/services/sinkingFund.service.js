const mongoose = require('mongoose');
const { ERROR_CODES, LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const SpendLog = require('../models/SpendLog.model');
const ApiError = require('../utils/ApiError');

const round2 = (value) => Math.round(value * 100) / 100;

function assertSinkingFund(lineItem, action) {
  if (lineItem.type !== LINE_ITEM_TYPES.SINKING_FUND) {
    throw new ApiError(
      400,
      `${action} is only valid on SINKING_FUND line items`,
      null,
      ERROR_CODES.WRONG_TYPE
    );
  }
}

function assertCanCover(lineItem, amount) {
  if (amount > lineItem.accumulatedBalance) {
    throw new ApiError(
      400,
      'amount cannot exceed the accumulated balance',
      null,
      ERROR_CODES.AMOUNT_EXCEEDS_BALANCE
    );
  }
}

/**
 * A sinking fund's allocation for the month IS the deposit: when a month is
 * cloned, the new month's allocation is added to the balance carried over
 * from the previous month (the very first deposit happens when the fund is
 * created — see lineItems.service.js). `sourceLineItem` is a plain object
 * (from .lean()).
 */
function carryForwardBalance(sourceLineItem) {
  if (sourceLineItem.type !== LINE_ITEM_TYPES.SINKING_FUND) {
    return { accumulatedBalance: 0 };
  }
  const deposit = sourceLineItem.allocatedAmount || 0;
  return { accumulatedBalance: round2((sourceLineItem.accumulatedBalance || 0) + deposit) };
}

/**
 * Withdraws money from a sinking fund — allowed at any time, before or after
 * the target is reached. Writes a SINKING_FUND_USED spend log entry, reduces
 * the accumulated balance and appends to cycleHistory. The pot's budget is
 * left untouched: the money was already counted as used when it was
 * allocated to the fund. Mutates and saves `lineItem` (a live Mongoose doc).
 */
async function withdrawFromFund(userId, lineItem, { amount, note, date }) {
  assertSinkingFund(lineItem, 'withdraw');
  assertCanCover(lineItem, amount);

  const usedAt = date ?? new Date();

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

  lineItem.accumulatedBalance = round2(lineItem.accumulatedBalance - amount);
  lineItem.cycleHistory.push({ usedAt, amount, note: note ?? null });
  // isReadyToUse is recomputed by the LineItem pre-save hook.
  await lineItem.save();

  return lineItem;
}

/**
 * FR-06 — Mark as Used. The original "spend the finished goal" flow: same as
 * a withdrawal, but only once the fund has reached its target.
 */
async function markLineItemUsed(userId, lineItem, { amount, note }) {
  assertSinkingFund(lineItem, 'mark-used');

  if (!lineItem.isReadyToUse) {
    throw new ApiError(
      400,
      'This sinking fund has not reached its target yet',
      null,
      ERROR_CODES.NOT_READY
    );
  }

  return withdrawFromFund(userId, lineItem, { amount, note });
}

/**
 * Moves money from one sinking fund to another in the same month. The source
 * balance drops and the destination balance rises, and each fund gets its
 * own spend log entry (TRANSFER_OUT / TRANSFER_IN, linked by transferId).
 * Pot budgets are untouched — the money never leaves the funds.
 */
async function transferBetweenFunds(userId, fromItem, toItem, { amount, note }) {
  assertSinkingFund(fromItem, 'transfer');
  assertSinkingFund(toItem, 'transfer');

  if (String(fromItem._id) === String(toItem._id)) {
    throw new ApiError(400, 'Choose two different funds', null, ERROR_CODES.SAME_FUND);
  }
  assertCanCover(fromItem, amount);

  const transferId = new mongoose.Types.ObjectId();
  const date = new Date();
  const base = { userId, date, amount, transferId };

  const fromBalanceBefore = fromItem.accumulatedBalance;
  fromItem.accumulatedBalance = round2(fromItem.accumulatedBalance - amount);
  await fromItem.save();

  try {
    toItem.accumulatedBalance = round2(toItem.accumulatedBalance + amount);
    await toItem.save();
  } catch (err) {
    // Put the money back so a failed transfer never loses funds.
    fromItem.accumulatedBalance = fromBalanceBefore;
    await fromItem.save();
    throw err;
  }

  await SpendLog.insertMany([
    {
      ...base,
      monthId: fromItem.monthId,
      potId: fromItem.potId,
      lineItemId: fromItem._id,
      type: SPEND_LOG_TYPES.TRANSFER_OUT,
      note: note ? `To ${toItem.name}: ${note}` : `To ${toItem.name}`,
    },
    {
      ...base,
      monthId: toItem.monthId,
      potId: toItem.potId,
      lineItemId: toItem._id,
      type: SPEND_LOG_TYPES.TRANSFER_IN,
      note: note ? `From ${fromItem.name}: ${note}` : `From ${fromItem.name}`,
    },
  ]);

  return { transferId, from: fromItem, to: toItem };
}

module.exports = {
  carryForwardBalance,
  withdrawFromFund,
  markLineItemUsed,
  transferBetweenFunds,
};
