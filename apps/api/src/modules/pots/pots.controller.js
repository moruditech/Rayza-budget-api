const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const potsService = require('./pots.service');

const list = asyncHandler(async (req, res) => {
  const pots = await potsService.listPots(req.userId, req.params.monthId);
  return ApiResponse.success(res, pots, 'Pots retrieved');
});

const create = asyncHandler(async (req, res) => {
  const pot = await potsService.createPot(req.userId, req.params.monthId, req.body);
  return ApiResponse.created(res, pot, 'Pot created');
});

const update = asyncHandler(async (req, res) => {
  const pot = await potsService.updatePot(
    req.userId,
    req.params.monthId,
    req.params.id,
    req.body
  );
  return ApiResponse.success(res, pot, 'Pot updated');
});

const remove = asyncHandler(async (req, res) => {
  await potsService.deletePot(req.userId, req.params.monthId, req.params.id, req.body);
  return ApiResponse.noContent(res, 'Pot deleted');
});

module.exports = { list, create, update, remove };
