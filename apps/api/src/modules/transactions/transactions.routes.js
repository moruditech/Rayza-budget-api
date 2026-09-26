const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./transactions.controller');
const { createTransactionSchema, updateTransactionSchema } = require('./transactions.validation');

const router = express.Router({ mergeParams: true });

router.post('/', authenticate, validateRequest(createTransactionSchema), ctrl.create);
router.patch('/:id', authenticate, validateRequest(updateTransactionSchema), ctrl.update);
router.delete('/:id', authenticate, ctrl.remove);

module.exports = router;
