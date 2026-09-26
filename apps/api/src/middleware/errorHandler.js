const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'Something went wrong';
  let fields = null;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    message = err.message;
    fields = err.fields;
  } else if (err.name === 'ValidationError' && err.errors) {
    // Mongoose schema validation error
    statusCode = 422;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed';
    fields = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  } else if (err.name === 'CastError') {
    // Invalid ObjectId
    statusCode = 404;
    errorCode = 'NOT_FOUND';
    message = 'Resource not found';
  } else if (err.code === 11000) {
    // Mongo duplicate key
    statusCode = 409;
    errorCode = 'DUPLICATE';
    message = 'Duplicate value violates a unique constraint';
    fields = Object.keys(err.keyPattern || {}).map((field) => ({
      field,
      message: `${field} already exists`,
    }));
  }

  if (statusCode >= 500) {
    logger.error(err.message, { stack: err.stack, requestId: req.id });
  } else {
    logger.warn(err.message, { errorCode, requestId: req.id });
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      fields,
      requestId: req.id,
    },
  });
}

module.exports = errorHandler;
