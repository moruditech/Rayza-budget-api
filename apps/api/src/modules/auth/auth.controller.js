const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const env = require('../../config/env');
const tokenService = require('../../services/token.service');
const logger = require('../../config/logger');
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

const me = asyncHandler(async (req, res) => {
  const data = await authService.getMe(req.userId);
  return ApiResponse.success(res, data, 'Profile retrieved');
});

const consent = asyncHandler(async (req, res) => {
  const data = await authService.acceptConsent(req.userId);
  return ApiResponse.success(res, data, 'Consent recorded');
});

// Always the same answer, and it does not wait for the email, so neither the
// message nor the response time shows whether the address has an account.
const forgotPassword = asyncHandler(async (req, res) => {
  authService
    .forgotPassword(req.body.email)
    .catch((err) => logger.error(`Forgot-password failed: ${err.message}`));
  return ApiResponse.success(
    res,
    null,
    'If that email has an account, a reset link is on its way'
  );
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  return ApiResponse.noContent(res, 'Password has been reset');
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  changePassword,
  me,
  consent,
  forgotPassword,
  resetPassword,
};
