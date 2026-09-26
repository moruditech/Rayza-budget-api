const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const { authRateLimiter, passwordChangeRateLimiter, registerRateLimiter } = require('../../config/rateLimiter');
const ctrl = require('./auth.controller');
const { registerSchema, loginSchema, changePasswordSchema } = require('./auth.validation');

const router = express.Router();

router.post('/register', registerRateLimiter, validateRequest(registerSchema), ctrl.register);

// Stricter rate limit on login attempts specifically, per rateLimiter.js.
router.post('/login', authRateLimiter, validateRequest(loginSchema), ctrl.login);

// No auth, no body — reads the refresh token from the HttpOnly cookie.
router.post('/refresh', ctrl.refresh);

router.post('/logout', authenticate, ctrl.logout);

// Rate-limited like login: changing a password means proving the current
// one, which is exactly the credential-guessing pattern authRateLimiter
// exists for — without this, anyone holding a valid (or stolen) access
// token could brute-force currentPassword at the much more permissive
// global rate limit instead. Checked before authenticate so a flood of
// requests is rejected cheaply, before paying for JWT verification.
router.patch(
  '/password',
  passwordChangeRateLimiter,
  authenticate,
  validateRequest(changePasswordSchema),
  ctrl.changePassword
);

module.exports = router;
