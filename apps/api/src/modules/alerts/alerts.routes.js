const express = require('express');
const authenticate = require('../../middleware/authenticate');
const ctrl = require('./alerts.controller');

const router = express.Router();

router.get('/', authenticate, ctrl.list);

module.exports = router;
