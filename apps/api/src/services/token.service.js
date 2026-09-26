const jwt = require('jsonwebtoken');
const ms = require('ms');
const { ERROR_CODES } = require('@budget-app/shared');
const env = require('../config/env');
const { redisClient } = require('../config/redis');
const ApiError = require('../utils/ApiError');

const BLACKLIST_PREFIX = 'bl:';

function signAccessToken(userId) {
  return jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function signRefreshToken(userId) {
  return jwt.sign({ userId }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN });
}

/** Verifies an access token's signature and expiry. Throws ApiError on failure. */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Access token expired', null, ERROR_CODES.TOKEN_EXPIRED);
    }
    throw new ApiError(401, 'Access token is invalid', null, ERROR_CODES.TOKEN_INVALID);
  }
}

/** Verifies a refresh token's signature and expiry. Throws ApiError on failure. */
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(
        401,
        'Refresh token expired, please log in again',
        null,
        ERROR_CODES.TOKEN_EXPIRED
      );
    }
    throw new ApiError(401, 'Refresh token is invalid', null, ERROR_CODES.TOKEN_INVALID);
  }
}

/**
 * O(1) Redis lookup, checked BEFORE JWT signature verification on every
 * protected request (see authenticate.js) — cheap rejection of a logged-out
 * token before paying for the CPU-expensive verify.
 */
async function isTokenBlacklisted(token) {
  const value = await redisClient.get(`${BLACKLIST_PREFIX}${token}`);
  return value !== null;
}

/**
 * Blacklists an access token for exactly as long as it would otherwise
 * remain valid, so the blacklist never grows unbounded. `decoded` is the
 * already-verified JWT payload (has `.exp`), as attached to req.user by
 * the authenticate middleware.
 */
async function blacklistToken(token, decoded) {
  const secondsRemaining = decoded.exp - Math.floor(Date.now() / 1000);
  if (secondsRemaining <= 0) return;
  await redisClient.set(`${BLACKLIST_PREFIX}${token}`, '1', { EX: secondsRemaining });
}

/** Refresh cookie maxAge in ms, derived from JWT_REFRESH_EXPIRES_IN (e.g. '7d'). */
function getRefreshCookieMaxAgeMs() {
  return ms(env.JWT_REFRESH_EXPIRES_IN);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  isTokenBlacklisted,
  blacklistToken,
  getRefreshCookieMaxAgeMs,
};
