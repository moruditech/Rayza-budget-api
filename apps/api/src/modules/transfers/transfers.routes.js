const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./transfers.controller');
const { createTransferSchema } = require('./transfers.validation');

const router = express.Router({ mergeParams: true });

router.post('/', authenticate, validateRequest(createTransferSchema), ctrl.create);

module.exports = router;
