const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const spendLogService = require('./spendLog.service');

const list = asyncHandler(async (req, res) => {
  const { data, meta } = await spendLogService.listSpendLog(req.userId, req.query);
  return ApiResponse.success(res, data, 'Spend log retrieved', meta);
});

module.exports = { list };
