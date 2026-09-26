const { ERROR_CODES, LINE_ITEM_TYPES, SPEND_LOG_TYPES } = require('@budget-app/shared');
const SpendLog = require('../../models/SpendLog.model');
const ApiError = require('../../utils/ApiError');
const monthService = require('../../services/month.service');
const potsService = require('../pots/pots.service');
const lineItemsService = require('../lineItems/lineItems.service');

async function getTransactionOrThrow(userId, potId, lineItemId, transactionId) {
  const spendLog = await SpendLog.findOne({
    _id: transactionId,
    userId,
    potId,
    lineItemId,
    type: SPEND_LOG_TYPES.INSTANT_SPEND,
  });
  if (!spendLog) {
    throw new ApiError(404, 'Transaction not found', null, ERROR_CODES.NOT_FOUND);
  }
  return spendLog;
}

// FR-05 — log a spend transaction. Only valid on INSTANT_SPEND line items.
// The response includes the pot's freshly recalculated spentAmount/surplus
// so the frontend can update immediately without a second request.
async function createTransaction(userId, monthId, potId, lineItemId, data) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  const lineItem = await lineItemsService.getLineItemOrThrow(userId, pot._id, lineItemId);

  if (lineItem.type !== LINE_ITEM_TYPES.INSTANT_SPEND) {
    throw new ApiError(
      400,
      'Transactions can only be logged against INSTANT_SPEND line items',
      null,
      ERROR_CODES.WRONG_TYPE
    );
  }

  const spendLog = await SpendLog.create({
    userId,
    monthId: month._id,
    potId: pot._id,
    lineItemId: lineItem._id,
    type: SPEND_LOG_TYPES.INSTANT_SPEND,
    amount: data.amount,
    date: data.date,
    note: data.note ?? null,
    paymentMethod: data.paymentMethod,
  });

  const spentAmount = await potsService.getPotSpentAmount(userId, pot._id);
  return {
    _id: spendLog._id,
    amount: spendLog.amount,
    date: spendLog.date,
    note: spendLog.note,
    paymentMethod: spendLog.paymentMethod,
    pot: {
      _id: pot._id,
      spentAmount,
      surplus: pot.budgetLimit + pot.rolloverBalance - spentAmount,
    },
  };
}

// FR-05 — edit a transaction.
async function updateTransaction(userId, monthId, potId, lineItemId, transactionId, updates) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  await lineItemsService.getLineItemOrThrow(userId, pot._id, lineItemId);
  const spendLog = await getTransactionOrThrow(userId, pot._id, lineItemId, transactionId);

  Object.assign(spendLog, updates);
  await spendLog.save();

  const spentAmount = await potsService.getPotSpentAmount(userId, pot._id);
  return {
    _id: spendLog._id,
    amount: spendLog.amount,
    pot: {
      spentAmount,
      surplus: pot.budgetLimit + pot.rolloverBalance - spentAmount,
    },
  };
}

// FR-05 — delete a transaction.
async function deleteTransaction(userId, monthId, potId, lineItemId, transactionId) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const pot = await potsService.getPotOrThrow(userId, month._id, potId);
  await lineItemsService.getLineItemOrThrow(userId, pot._id, lineItemId);
  const spendLog = await getTransactionOrThrow(userId, pot._id, lineItemId, transactionId);

  await spendLog.deleteOne();

  const spentAmount = await potsService.getPotSpentAmount(userId, pot._id);
  return {
    pot: {
      spentAmount,
      surplus: pot.budgetLimit + pot.rolloverBalance - spentAmount,
    },
  };
}

module.exports = { createTransaction, updateTransaction, deleteTransaction };
