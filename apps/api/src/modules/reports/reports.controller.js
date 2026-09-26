const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const reportsService = require('./reports.service');

const incomeVsSpend = asyncHandler(async (req, res) => {
  const data = await reportsService.getIncomeVsSpend(req.userId, req.query.months);
  return ApiResponse.success(res, data, 'Report retrieved');
});

const spendingByPot = asyncHandler(async (req, res) => {
  const data = await reportsService.getSpendingByPot(req.userId, req.query.monthId);
  return ApiResponse.success(res, data, 'Report retrieved');
});

const sinkingFundProgress = asyncHandler(async (req, res) => {
  const data = await reportsService.getSinkingFundProgress(req.userId, req.query.months);
  return ApiResponse.success(res, data, 'Report retrieved');
});

const healthHistory = asyncHandler(async (req, res) => {
  const data = await reportsService.getHealthHistory(req.userId, req.query.months);
  return ApiResponse.success(res, data, 'Report retrieved');
});

const categoryBreakdown = asyncHandler(async (req, res) => {
  const data = await reportsService.getCategoryBreakdown(req.userId, req.query.monthId);
  return ApiResponse.success(res, data, 'Report retrieved');
});

module.exports = {
  incomeVsSpend,
  spendingByPot,
  sinkingFundProgress,
  healthHistory,
  categoryBreakdown,
};
