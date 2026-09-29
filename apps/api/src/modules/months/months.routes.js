const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./months.controller');
const { createMonthSchema, rolloverSchema } = require('./months.validation');

const router = express.Router();

router.get('/', authenticate, ctrl.list);
router.get('/:id', authenticate, ctrl.getOne);
router.post('/', authenticate, validateRequest(createMonthSchema), ctrl.create);

// Clone's body is the same { year, month } shape as create.
router.post('/:id/clone', authenticate, validateRequest(createMonthSchema), ctrl.clone);
router.patch('/:id/lock', authenticate, ctrl.lock);
router.delete('/:id', authenticate, ctrl.remove);
router.post('/:id/rollover', authenticate, validateRequest(rolloverSchema), ctrl.rollover);

module.exports = router;
