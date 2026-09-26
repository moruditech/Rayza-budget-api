class ApiError extends Error {
  constructor(statusCode, message, fields = null, errorCode = 'ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.fields = fields;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
