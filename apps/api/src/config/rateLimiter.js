const rateLimit = require('express-rate-limit');
const env = require('./env');
const ApiError = require('../utils/ApiError');

const rateLimitHandler = (req, res, next) => {
  next(new ApiError(429, 'Too many requests, please try again later', null, 'RATE_LIMITED'));
};

// Integration tests legitimately register/log in many times in quick
// succession from a single loopback address (e.g. a fresh user per test
// case's beforeEach) — indistinguishable in shape from abuse to a rate
// limiter, but not abuse. Disabling rate limiting only in the test
// environment avoids spurious 429s in the test suite without changing
// production or development behavior at all.
const isTestEnv = env.NODE_ENV === 'test';

// 100 requests per 15 minutes per IP, applied globally.
// The health check is exempted via `skip` rather than by mounting it before
// this middleware, so the documented middleware order (rate limiter at
// position 6, health check at position 9) can stay intact.
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: (req) => isTestEnv || req.path === '/api/v1/health',
});

// Stricter limit for login attempts specifically.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skipSuccessfulRequests: true,
  skip: () => isTestEnv,
});

// Same shape as authRateLimiter, but its own instance. express-rate-limit's
// default in-memory store keys by IP only, not by route — reusing the same
// limiter() call across two routes would share one counter between them,
// so a few mistyped login attempts could wrongly count against (or get
// counted from) an unrelated password-change attempt from the same IP.
const passwordChangeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skipSuccessfulRequests: true,
  skip: () => isTestEnv,
});

// Limit for account registration. Deliberately does NOT skip successful
// requests: unlike login or password-change brute-forcing (which look like
// many failures), registration abuse — spam accounts, or just running up
// the server's bcrypt.hash cost repeatedly — looks like many SUCCESSFUL
// requests, so skipSuccessfulRequests would defeat the point here.
const registerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => isTestEnv,
});

// Asking for a reset email: each one is a real email sent, so keep it tight.
const forgotPasswordRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => isTestEnv,
});

// Using a reset token: stops guessing tokens.
const resetPasswordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: () => isTestEnv,
});

// Deleting an account needs the password, so guard it like a login.
const accountDeleteRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skipSuccessfulRequests: true,
  skip: () => isTestEnv,
});

module.exports = {
  forgotPasswordRateLimiter,
  resetPasswordRateLimiter,
  accountDeleteRateLimiter,
  globalRateLimiter,
  authRateLimiter,
  passwordChangeRateLimiter,
  registerRateLimiter,
};
