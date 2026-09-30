const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const { accountDeleteRateLimiter } = require('../../config/rateLimiter');
const ctrl = require('./account.controller');
const { deleteAccountSchema } = require('./account.validation');

const router = express.Router();

// Download everything the app holds about the signed-in person.
router.get('/export', authenticate, ctrl.exportData);

// Permanently delete the account and all its data (password required).
router.delete(
  '/',
  accountDeleteRateLimiter,
  authenticate,
  validateRequest(deleteAccountSchema),
  ctrl.deleteAccount
);

module.exports = router;
