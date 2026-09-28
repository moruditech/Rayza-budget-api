const express = require('express');

const router = express.Router();

router.use('/auth', require('../modules/auth/auth.routes'));

// Order matters here: each mount path below is a strict prefix of the one
// after it, so the more specific (longer) path is always registered first
// — otherwise Express would match the shorter prefix and never try the
// more specific router for that request.
//   /months/:monthId/pots/:potId/line-items/:lineItemId/transactions
//   /months/:monthId/pots/:potId/line-items
//   /months/:monthId/transfers
//   /months/:monthId/pots
//   /months/:monthId/income
//   /months
router.use(
  '/months/:monthId/pots/:potId/line-items/:lineItemId/transactions',
  require('../modules/transactions/transactions.routes')
);
router.use('/months/:monthId/pots/:potId/line-items', require('../modules/lineItems/lineItems.routes'));
router.use('/months/:monthId/transfers', require('../modules/transfers/transfers.routes'));
router.use('/months/:monthId/pots', require('../modules/pots/pots.routes'));
router.use('/months/:monthId/income', require('../modules/income/income.routes'));
router.use('/months', require('../modules/months/months.routes'));

router.use('/spend-log', require('../modules/spendLog/spendLog.routes'));
router.use('/alerts', require('../modules/alerts/alerts.routes'));
router.use('/reports', require('../modules/reports/reports.routes'));

module.exports = router;
