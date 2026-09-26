const request = require('supertest');
const app = require('../../src/app');

describe('Unknown routes', () => {
  it('returns a structured 404 error envelope for an unmounted route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('/api/v1/does-not-exist');
    expect(res.body.error.requestId).toBeDefined();
  });
});
