const ApiError = require('../utils/ApiError');

function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, null, 'NOT_FOUND'));
}

module.exports = notFound;
