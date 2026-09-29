const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./lineItems.controller');
const {
  createLineItemSchema,
  updateLineItemSchema,
  markUsedSchema,
  withdrawSchema,
  depositSchema,
  recordInterestSchema,
} = require('./lineItems.validation');

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, ctrl.list);
router.post('/', authenticate, validateRequest(createLineItemSchema), ctrl.create);
router.patch('/:id', authenticate, validateRequest(updateLineItemSchema), ctrl.update);
router.delete('/:id', authenticate, ctrl.remove);
router.post('/:id/interest', authenticate, validateRequest(recordInterestSchema), ctrl.recordInterest);
router.post('/:id/deposit', authenticate, validateRequest(depositSchema), ctrl.deposit);
router.post('/:id/withdraw', authenticate, validateRequest(withdrawSchema), ctrl.withdraw);
router.post('/:id/mark-used', authenticate, validateRequest(markUsedSchema), ctrl.markUsed);

module.exports = router;
