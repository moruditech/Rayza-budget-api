const asyncHandler = require('../../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  it('calls the wrapped function with req, res, next', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const req = {};
    const res = {};
    const next = jest.fn();

    await asyncHandler(fn)(req, res, next);

    expect(fn).toHaveBeenCalledWith(req, res, next);
  });

  it('forwards a rejected promise to next()', async () => {
    const error = new Error('boom');
    const fn = jest.fn().mockRejectedValue(error);
    const next = jest.fn();

    await asyncHandler(fn)({}, {}, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('does not call next() when the handler resolves', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const next = jest.fn();

    await asyncHandler(fn)({}, {}, next);

    expect(next).not.toHaveBeenCalled();
  });
});
