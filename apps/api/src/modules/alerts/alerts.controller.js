const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const alertsService = require('./alerts.service');

const list = asyncHandler(async (req, res) => {
  const alerts = await alertsService.evaluateAlerts(req.userId);
  return ApiResponse.success(res, alerts, 'Alerts retrieved');
});

module.exports = { list };
