const ApiError = require('../utils/ApiError');

/**
 * @param {import('zod').ZodSchema} schema
 */
function validateRequest(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return next(new ApiError(422, 'Validation failed', fields, 'VALIDATION_ERROR'));
    }
    req.body = result.data;
    return next();
  };
}

/**
 * @param {import('zod').ZodSchema} schema
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return next(new ApiError(422, 'Validation failed', fields, 'VALIDATION_ERROR'));
    }
    req.query = result.data;
    return next();
  };
}

module.exports = validateRequest;
module.exports.validateQuery = validateQuery;
