const ApiError = require('../../../src/utils/ApiError');

describe('ApiError', () => {
  it('sets statusCode, message, fields, and errorCode', () => {
    const err = new ApiError(404, 'Pot not found', null, 'NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Pot not found');
    expect(err.fields).toBeNull();
    expect(err.errorCode).toBe('NOT_FOUND');
    expect(err.isOperational).toBe(true);
  });

  it('defaults errorCode to ERROR and fields to null', () => {
    const err = new ApiError(500, 'Something broke');
    expect(err.errorCode).toBe('ERROR');
    expect(err.fields).toBeNull();
  });

  it('is an instance of Error', () => {
    const err = new ApiError(400, 'Bad request');
    expect(err).toBeInstanceOf(Error);
  });

  it('carries field-level validation details', () => {
    const fields = [{ field: 'budgetLimit', message: 'Expected number, received string' }];
    const err = new ApiError(422, 'Validation failed', fields, 'VALIDATION_ERROR');
    expect(err.fields).toEqual(fields);
  });
});
