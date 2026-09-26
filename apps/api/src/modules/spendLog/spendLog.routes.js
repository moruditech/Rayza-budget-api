const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./spendLog.controller');
const { spendLogQuerySchema } = require('./spendLog.validation');

const router = express.Router();

router.get('/', authenticate, validateRequest.validateQuery(spendLogQuerySchema), ctrl.list);

module.exports = router;
