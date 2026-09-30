const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./reports.controller');
const { monthsQuerySchema, monthIdQuerySchema } = require('./reports.validation');

const router = express.Router();

router.get(
  '/income-vs-spend',
  authenticate,
  validateRequest.validateQuery(monthsQuerySchema),
  ctrl.incomeVsSpend
);
router.get(
  '/spending-by-pot',
  authenticate,
  validateRequest.validateQuery(monthIdQuerySchema),
  ctrl.spendingByPot
);
router.get(
  '/pot-comparison',
  authenticate,
  validateRequest.validateQuery(monthIdQuerySchema),
  ctrl.potComparison
);
router.get(
  '/sinking-fund-progress',
  authenticate,
  validateRequest.validateQuery(monthsQuerySchema),
  ctrl.sinkingFundProgress
);
router.get(
  '/health-history',
  authenticate,
  validateRequest.validateQuery(monthsQuerySchema),
  ctrl.healthHistory
);
router.get(
  '/category-breakdown',
  authenticate,
  validateRequest.validateQuery(monthIdQuerySchema),
  ctrl.categoryBreakdown
);

module.exports = router;
