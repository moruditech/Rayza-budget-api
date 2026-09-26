const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const monthsService = require('./months.service');

const list = asyncHandler(async (req, res) => {
  const months = await monthsService.listMonths(req.userId);
  return ApiResponse.success(res, months, 'Months retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const month = await monthsService.getMonthDetail(req.userId, req.params.id);
  return ApiResponse.success(res, month, 'Month retrieved');
});

const create = asyncHandler(async (req, res) => {
  const month = await monthsService.createMonth(req.userId, req.body);
  return ApiResponse.created(res, month, 'Month created');
});

const clone = asyncHandler(async (req, res) => {
  const month = await monthsService.cloneMonth(req.userId, req.params.id, req.body);
  return ApiResponse.created(res, month, 'Month cloned successfully');
});

const lock = asyncHandler(async (req, res) => {
  const month = await monthsService.lockMonth(req.userId, req.params.id);
  return ApiResponse.success(res, month, 'Month locked');
});

const rollover = asyncHandler(async (req, res) => {
  await monthsService.submitRollover(req.userId, req.params.id, req.body.decisions);
  return ApiResponse.noContent(res, 'Rollover decisions saved');
});

module.exports = { list, getOne, create, clone, lock, rollover };
