const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const env = require('../../config/env');
const tokenService = require('../../services/token.service');
const authService = require('./auth.service');

const REFRESH_COOKIE_NAME = 'refreshToken';
// Scoped to /api/v1/auth per the API Contract — the cookie is only ever
// sent back on refresh/logout requests.
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: tokenService.getRefreshCookieMaxAgeMs(),
  };
}

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  return ApiResponse.created(res, user, 'Registration successful');
});

const login = asyncHandler(async (req, res) => {
  const { accessToken, refreshToken } = await authService.login(req.body);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  return ApiResponse.success(res, { accessToken }, 'Login successful');
});

const refresh = asyncHandler(async (req, res) => {
  const { accessToken } = await authService.refresh(req.cookies?.[REFRESH_COOKIE_NAME]);
  return ApiResponse.success(res, { accessToken }, 'Token refreshed');
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.accessToken, req.user);
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  return ApiResponse.noContent(res, 'Logged out successfully');
});

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.userId, req.body);
  return ApiResponse.noContent(res, 'Password updated successfully');
});

module.exports = { register, login, refresh, logout, changePassword };
