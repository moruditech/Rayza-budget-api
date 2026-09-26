const mongoose = require('mongoose');
const { ERROR_CODES, LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const LineItem = require('../../models/LineItem.model');
const SpendLog = require('../../models/SpendLog.model');
const ApiError = require('../../utils/ApiError');
const monthService = require('../../services/month.service');
const sinkingFundService = require('../../services/sinkingFund.service');
const potsService = require('../pots/pots.service');

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
  };

  if (li.type === LINE_ITEM_TYPES.INSTANT_SPEND) {
    return { ...base, spentAmount };
  }

  const progress =
    li.targetAmount > 0 ? Math.round((li.accumulatedBalance / li.targetAmount) * 1000) / 10 : 0;

  return {
    ...base,
    targetAmount: li.targetAmount,
    monthlyContribution: li.monthlyContribution,
    accumulatedBalance: li.accumulatedBalance,
    isReadyToUse: li.isReadyToUse,
    progress,
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

function assertTypeFieldsOnCreate(data) {
  if (data.type === LINE_ITEM_TYPES.INSTANT_SPEND) {
    if (data.targetAmount !== undefined || data.monthlyContribution !== undefined) {
      throw new ApiError(
        400,
        'targetAmount and monthlyContribution are not valid for INSTANT_SPEND line items',
        null,
        ERROR_CODES.INVALID_FIELDS_FOR_TYPE
      );
    }
  } else if (data.type === LINE_ITEM_TYPES.SINKING_FUND) {
    if (data.targetAmount === undefined || data.monthlyContribution === undefined) {
      throw new ApiError(
        400,
        'targetAmount and monthlyContribution are required for SINKING_FUND line items',
        null,
        ERROR_CODES.SINKING_FUND_FIELDS
      );
    }
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

  const lineItem = await LineItem.create({
    userId,
    potId: pot._id,
    monthId: month._id,
    name: data.name,
    type: data.type,
    allocatedAmount: data.allocatedAmount,
    isRecurring: data.isRecurring ?? false,
    order: data.order ?? 0,
    targetAmount: data.type === LINE_ITEM_TYPES.SINKING_FUND ? data.targetAmount : undefined,
    monthlyContribution:
      data.type === LINE_ITEM_TYPES.SINKING_FUND ? data.monthlyContribution : undefined,
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
    (updates.targetAmount !== undefined || updates.monthlyContribution !== undefined)
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

module.exports = {
  serializeLineItem,
  getSpendMapByMonth,
  getLineItemSpentAmount,
  getLineItemOrThrow,
  listLineItems,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  markLineItem,
};
