const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const Month = require('../../src/models/Month.model');
const Pot = require('../../src/models/Pot.model');
const LineItem = require('../../src/models/LineItem.model');
const SpendLog = require('../../src/models/SpendLog.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/authHelper');
const { redisClient, connectRedis, disconnectRedis } = require('../../src/config/redis');

let accessToken;
let user;
const auth = (req) => req.set('Authorization', `Bearer ${accessToken}`);

beforeAll(async () => {
  await connectTestDB();
  await connectRedis();
});
beforeEach(async () => {
  ({ user, accessToken } = await registerAndLogin(app));
});
afterEach(async () => {
  await clearTestDB();
  await redisClient.flushDb();
});
afterAll(async () => {
  await closeTestDB();
  await disconnectRedis();
});

async function seed() {
  const month = (await auth(request(app).post('/api/v1/months')).send({ year: 2026, month: 9 })).body.data;
  await auth(request(app).post(`/api/v1/months/${month._id}/income`)).send({ label: 'Salary', amount: 5000 });
  const pot = (await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({ name: 'Food', type: 'SPENDING', budgetLimit: 1000 })).body.data;
  const item = (await auth(request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)).send({ name: 'Groceries', type: 'INSTANT_SPEND', allocatedAmount: 500 })).body.data;
  await auth(request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items/${item._id}/transactions`)).send({ amount: 100, date: new Date().toISOString(), paymentMethod: 'CARD' });
}

describe('Download my data', () => {
  it('returns the account and everything in it, without the password hash', async () => {
    await seed();
    const res = await auth(request(app).get('/api/v1/account/export'));
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.account.email).toBe(user.email);
    expect(data.months).toHaveLength(1);
    expect(data.pots).toHaveLength(1);
    expect(data.lineItems).toHaveLength(1);
    expect(data.income).toHaveLength(1);
    expect(data.spendLog).toHaveLength(1);
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|Str0ngPass1/);
  });

  it("does not include anyone else's data", async () => {
    await seed();
    ({ accessToken } = await registerAndLogin(app));
    const data = (await auth(request(app).get('/api/v1/account/export'))).body.data;
    expect(data.months).toHaveLength(0);
    expect(data.spendLog).toHaveLength(0);
  });

  it('needs a login', async () => {
    expect((await request(app).get('/api/v1/account/export')).status).toBe(401);
  });
});

describe('Delete my account', () => {
  it('needs the right password, then removes the account and all its data', async () => {
    await seed();
    const wrong = await auth(request(app).delete('/api/v1/account')).send({ password: 'WrongPass1' });
    expect(wrong.status).toBe(401);
    expect(await User.countDocuments()).toBe(1);

    const ok = await auth(request(app).delete('/api/v1/account')).send({ password: user.password });
    expect(ok.status).toBeLessThan(300);

    for (const model of [User, Month, Pot, LineItem, SpendLog]) {
      expect(await model.countDocuments()).toBe(0);
    }
    // The old session is finished, and so is the login.
    expect((await auth(request(app).get('/api/v1/auth/me'))).status).toBe(401);
    const again = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(again.status).toBe(401);
  });

  it("leaves other people's data alone", async () => {
    await seed();
    const first = { accessToken, user };
    ({ user, accessToken } = await registerAndLogin(app));
    await seed();
    await auth(request(app).delete('/api/v1/account')).send({ password: user.password });

    expect(await User.countDocuments()).toBe(1);
    expect(await Month.countDocuments()).toBe(1);
    expect(await User.findOne({ email: first.user.email })).not.toBeNull();
  });
});
