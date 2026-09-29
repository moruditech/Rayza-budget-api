const request = require('supertest');
const app = require('../../src/app');
const { connectTestDB, clearTestDB, closeTestDB } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/authHelper');
const { redisClient, connectRedis, disconnectRedis } = require('../../src/config/redis');

let accessToken;
const auth = (req) => req.set('Authorization', `Bearer ${accessToken}`);

beforeAll(async () => {
  await connectTestDB();
  await connectRedis();
});
beforeEach(async () => {
  ({ accessToken } = await registerAndLogin(app));
});
afterEach(async () => {
  await clearTestDB();
  await redisClient.flushDb();
});
afterAll(async () => {
  await closeTestDB();
  await disconnectRedis();
});

describe('DELETE /months/:id', () => {
  it('removes the month and everything in it, but leaves other months alone', async () => {
    const keep = (await auth(request(app).post('/api/v1/months')).send({ year: 2026, month: 8 })).body.data;
    const doomed = (await auth(request(app).post('/api/v1/months')).send({ year: 2026, month: 9 })).body.data;
    await auth(request(app).post(`/api/v1/months/${doomed._id}/income`)).send({ label: 'Salary', amount: 5000 });
    const pot = (
      await auth(request(app).post(`/api/v1/months/${doomed._id}/pots`)).send({
        name: 'Food',
        type: 'SPENDING',
        budgetLimit: 1000,
      })
    ).body.data;
    await auth(request(app).post(`/api/v1/months/${doomed._id}/pots/${pot._id}/line-items`)).send({
      name: 'Groceries',
      type: 'INSTANT_SPEND',
      allocatedAmount: 500,
    });

    const res = await auth(request(app).delete(`/api/v1/months/${doomed._id}`));
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toMatchObject({ pots: 1, lineItems: 1, income: 1 });

    const list = await auth(request(app).get('/api/v1/months'));
    expect(list.body.data.map((m) => m._id)).toEqual([keep._id]);
    expect((await auth(request(app).get(`/api/v1/months/${doomed._id}`))).status).toBe(404);
  });

  it('can delete a locked month', async () => {
    const month = (await auth(request(app).post('/api/v1/months')).send({ year: 2026, month: 7 })).body.data;
    await auth(request(app).patch(`/api/v1/months/${month._id}/lock`));
    const res = await auth(request(app).delete(`/api/v1/months/${month._id}`));
    expect(res.status).toBe(200);
  });

  it("cannot delete another user's month", async () => {
    const month = (await auth(request(app).post('/api/v1/months')).send({ year: 2026, month: 6 })).body.data;
    ({ accessToken } = await registerAndLogin(app, { email: 'other@example.com' }));
    const res = await auth(request(app).delete(`/api/v1/months/${month._id}`));
    expect(res.status).toBe(404);
  });
});
