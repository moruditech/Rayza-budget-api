const ApiResponse = require('../../../src/utils/ApiResponse');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('ApiResponse', () => {
  it('success() sends a 200 envelope with data and message', () => {
    const res = mockRes();
    ApiResponse.success(res, { id: 1 }, 'Pots retrieved');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 1 },
      message: 'Pots retrieved',
    });
  });

  it('success() includes meta only when provided', () => {
    const res = mockRes();
    ApiResponse.success(res, [], 'Spend log retrieved', { page: 1, limit: 20, total: 47 });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [],
      message: 'Spend log retrieved',
      meta: { page: 1, limit: 20, total: 47 },
    });
  });

  it('created() sends a 201 envelope', () => {
    const res = mockRes();
    ApiResponse.created(res, { id: 1 }, 'Pot created');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 1 },
      message: 'Pot created',
    });
  });

  it('noContent() sends a 200 envelope with null data', () => {
    const res = mockRes();
    ApiResponse.noContent(res, 'Logged out successfully');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: null,
      message: 'Logged out successfully',
    });
  });
});
