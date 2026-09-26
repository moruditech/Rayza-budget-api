const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const ctrl = require('./pots.controller');
const { createPotSchema, updatePotSchema, deletePotSchema } = require('./pots.validation');

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, ctrl.list);
router.post('/', authenticate, validateRequest(createPotSchema), ctrl.create);
router.patch('/:id', authenticate, validateRequest(updatePotSchema), ctrl.update);
router.delete('/:id', authenticate, validateRequest(deletePotSchema), ctrl.remove);

module.exports = router;
