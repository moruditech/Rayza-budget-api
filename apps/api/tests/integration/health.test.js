const request = require('supertest');
const app = require('../../src/app');

describe('GET /api/v1/health', () => {
  it('returns 200 with a healthy status and no auth required', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('sets an X-Request-ID header on every response', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('is exempt from the global rate limiter, even across a burst of requests', async () => {
    const requests = Array.from({ length: 20 }, () => request(app).get('/api/v1/health'));
    const responses = await Promise.all(requests);
    responses.forEach((res) => expect(res.status).toBe(200));
  });
});
