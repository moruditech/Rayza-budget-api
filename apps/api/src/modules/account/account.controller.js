const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const accountService = require('./account.service');

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const exportData = asyncHandler(async (req, res) => {
  const data = await accountService.exportData(req.userId);
  return ApiResponse.success(res, data, 'Data export ready');
});

const deleteAccount = asyncHandler(async (req, res) => {
  await accountService.deleteAccount(req.userId, req.body.password, req.accessToken, req.user);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  return ApiResponse.noContent(res, 'Account deleted');
});

module.exports = { exportData, deleteAccount };
