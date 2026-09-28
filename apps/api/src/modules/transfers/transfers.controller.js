const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const transfersService = require('./transfers.service');

const create = asyncHandler(async (req, res) => {
  const result = await transfersService.createTransfer(req.userId, req.params.monthId, req.body);
  return ApiResponse.created(res, result, 'Transfer completed');
});

module.exports = { create };
