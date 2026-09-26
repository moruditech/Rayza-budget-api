const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const transactionsService = require('./transactions.service');

const create = asyncHandler(async (req, res) => {
  const transaction = await transactionsService.createTransaction(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.lineItemId,
    req.body
  );
  return ApiResponse.created(res, transaction, 'Transaction logged');
});

const update = asyncHandler(async (req, res) => {
  const transaction = await transactionsService.updateTransaction(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.lineItemId,
    req.params.id,
    req.body
  );
  return ApiResponse.success(res, transaction, 'Transaction updated');
});

const remove = asyncHandler(async (req, res) => {
  const result = await transactionsService.deleteTransaction(
    req.userId,
    req.params.monthId,
    req.params.potId,
    req.params.lineItemId,
    req.params.id
  );
  return ApiResponse.success(res, result, 'Transaction deleted');
});

module.exports = { create, update, remove };
