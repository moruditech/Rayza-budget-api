const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const lineItemsService = require('./lineItems.service');

const list = asyncHandler(async (req, res) => {
  const lineItems = await lineItemsService.listLineItems(
    req.userId,
    req.params.monthId,
    req.params.potId
  );
  return ApiResponse.success(res, lineItems, 'Line items retrieved');
});

const create = asyncHandler(async (req, res) => {
  const lineItem = await lineItemsService.createLineItem(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.body
  );
  return ApiResponse.created(res, lineItem, 'Line item created');
});

const update = asyncHandler(async (req, res) => {
  const lineItem = await lineItemsService.updateLineItem(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.id,
    req.body
  );
  return ApiResponse.success(res, lineItem, 'Line item updated');
});

const remove = asyncHandler(async (req, res) => {
  await lineItemsService.deleteLineItem(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.id
  );
  return ApiResponse.noContent(res, 'Line item deleted');
});

const markUsed = asyncHandler(async (req, res) => {
  const result = await lineItemsService.markLineItem(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.id,
    req.body
  );
  return ApiResponse.success(res, result, 'Sinking fund marked as used');
});

const withdraw = asyncHandler(async (req, res) => {
  const result = await lineItemsService.withdrawLineItem(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.id,
    req.body
  );
  return ApiResponse.success(res, result, 'Withdrawal recorded');
});

const deposit = asyncHandler(async (req, res) => {
  const result = await lineItemsService.depositLineItem(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.id,
    req.body
  );
  return ApiResponse.success(res, result, 'Deposit recorded');
});

module.exports = { list, create, update, remove, markUsed, withdraw, deposit };
