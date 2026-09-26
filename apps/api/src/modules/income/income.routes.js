const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./income.controller');
const { createIncomeSchema, updateIncomeSchema } = require('./income.validation');

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, ctrl.list);
router.post('/', authenticate, validateRequest(createIncomeSchema), ctrl.create);
router.patch('/:id', authenticate, validateRequest(updateIncomeSchema), ctrl.update);
router.delete('/:id', authenticate, ctrl.remove);

module.exports = router;
