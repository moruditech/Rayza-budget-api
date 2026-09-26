const { ERROR_CODES } = require('@budget-app/shared');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const tokenService = require('../services/token.service');

/**
 * Runs before every protected route. Per the Backend Architecture doc:
 *   1. Extract the Bearer token
 *   2. Check the Redis blacklist first (fast O(1) lookup)
 *   3. Verify the JWT signature and expiry
 *   4. Attach req.user / req.userId
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Authentication token missing', null, ERROR_CODES.TOKEN_INVALID);
  }

  const blacklisted = await tokenService.isTokenBlacklisted(token);
  if (blacklisted) {
    throw new ApiError(401, 'Token has been revoked', null, ERROR_CODES.TOKEN_REVOKED);
  }

  const decoded = tokenService.verifyAccessToken(token);

  req.user = decoded;
  req.userId = decoded.userId;
  // Kept so /auth/logout can blacklist this exact token string.
  req.accessToken = token;

  next();
});

module.exports = authenticate;
