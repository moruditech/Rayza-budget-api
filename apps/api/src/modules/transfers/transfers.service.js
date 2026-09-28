const { ERROR_CODES } = require('@budget-app/shared');
const LineItem = require('../../models/LineItem.model');
const ApiError = require('../../utils/ApiError');
const monthService = require('../../services/month.service');
const sinkingFundService = require('../../services/sinkingFund.service');
const lineItemsService = require('../lineItems/lineItems.service');

async function getFundOrThrow(userId, monthId, lineItemId) {
  const lineItem = await LineItem.findOne({ _id: lineItemId, userId, monthId });
  if (!lineItem) {
    throw new ApiError(404, 'Line item not found in this month', null, ERROR_CODES.NOT_FOUND);
  }
  return lineItem;
}

// Move money from one sinking fund to another (any pot, same month). Reduces
// the source fund, increases the destination, and logs both sides.
async function createTransfer(userId, monthId, { fromLineItemId, toLineItemId, amount, note }) {
  const month = await monthService.getMonthOrThrow(userId, monthId);
  monthService.assertMonthUnlocked(month);

  const [fromItem, toItem] = await Promise.all([
    getFundOrThrow(userId, month._id, fromLineItemId),
    getFundOrThrow(userId, month._id, toLineItemId),
  ]);

  const { transferId } = await sinkingFundService.transferBetweenFunds(userId, fromItem, toItem, {
    amount,
    note,
  });

  return {
    transferId,
    amount,
    from: lineItemsService.serializeLineItem(fromItem.toObject(), 0),
    to: lineItemsService.serializeLineItem(toItem.toObject(), 0),
  };
}

module.exports = { createTransfer };
