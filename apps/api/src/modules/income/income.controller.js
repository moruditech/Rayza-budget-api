const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const incomeService = require('./income.service');

const list = asyncHandler(async (req, res) => {
  const income = await incomeService.listIncome(req.userId, req.params.monthId);
  return ApiResponse.success(res, income, 'Income retrieved');
});

const create = asyncHandler(async (req, res) => {
  const income = await incomeService.createIncome(req.userId, req.params.monthId, req.body);
  return ApiResponse.created(res, income, 'Income source added');
});

const update = asyncHandler(async (req, res) => {
  const income = await incomeService.updateIncome(
    req.userId,
    req.params.monthId,
    req.params.id,
    req.body
  );
  return ApiResponse.success(res, income, 'Income source updated');
});

const remove = asyncHandler(async (req, res) => {
  await incomeService.deleteIncome(req.userId, req.params.monthId, req.params.id);
  return ApiResponse.noContent(res, 'Income source deleted');
});

module.exports = { list, create, update, remove };
