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

// The alerts endpoint judges "today" by the UTC calendar, so the tests do too.
async function setupCurrentMonth() {
  const now = new Date();
  const month = (
    await auth(request(app).post('/api/v1/months')).send({
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
    })
  ).body.data;
  const pot = (
    await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Bills',
      type: 'SPENDING',
      budgetLimit: 5000,
    })
  ).body.data;
  return { month, pot, today: now.getUTCDate() };
}

const itemsUrl = (month, pot) => `/api/v1/months/${month._id}/pots/${pot._id}/line-items`;
const billAlerts = async () =>
  (await auth(request(app).get('/api/v1/alerts'))).body.data.filter((a) => a.type.startsWith('BILL_'));

describe('Bills with a due day', () => {
  it('alerts when a bill is due today and stops once it is marked paid', async () => {
    const { month, pot, today } = await setupCurrentMonth();
    const bill = (
      await auth(request(app).post(itemsUrl(month, pot))).send({
        name: 'Data & Minutes',
        type: 'INSTANT_SPEND',
        allocatedAmount: 299,
        dueDay: today,
      })
    ).body.data;
    expect(bill.dueDay).toBe(today);
    expect(bill.isPaid).toBe(false);

    const alerts = await billAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'BILL_DUE', message: 'Data & Minutes is due today' });

    const paid = await auth(request(app).post(`${itemsUrl(month, pot)}/${bill._id}/paid`)).send({ paid: true });
    expect(paid.status).toBe(200);
    expect(paid.body.data.isPaid).toBe(true);
    expect(await billAlerts()).toHaveLength(0);

    // Undo brings the reminder back.
    await auth(request(app).post(`${itemsUrl(month, pot)}/${bill._id}/paid`)).send({ paid: false });
    expect(await billAlerts()).toHaveLength(1);
  });

  it('flags a bill whose due day has passed as overdue', async () => {
    const { month, pot, today } = await setupCurrentMonth();
    if (today < 3) return; // no earlier day this month to test with
    await auth(request(app).post(itemsUrl(month, pot))).send({
      name: 'Rent',
      type: 'INSTANT_SPEND',
      allocatedAmount: 100,
      dueDay: today - 2,
    });
    const [alert] = await billAlerts();
    expect(alert).toMatchObject({ type: 'BILL_OVERDUE', message: 'Rent was due 2 days ago' });
  });

  it('does not alert for a bill that is far away, or for items without a due day', async () => {
    const { month, pot, today } = await setupCurrentMonth();
    const lastDay = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)).getUTCDate();
    if (today + 5 <= lastDay) {
      await auth(request(app).post(itemsUrl(month, pot))).send({
        name: 'Later',
        type: 'INSTANT_SPEND',
        allocatedAmount: 100,
        dueDay: today + 5,
      });
    }
    await auth(request(app).post(itemsUrl(month, pot))).send({
      name: 'Groceries',
      type: 'INSTANT_SPEND',
      allocatedAmount: 100,
    });
    expect(await billAlerts()).toHaveLength(0);
  });

  it('refuses to mark an item paid when it has no due day', async () => {
    const { month, pot } = await setupCurrentMonth();
    const item = (
      await auth(request(app).post(itemsUrl(month, pot))).send({
        name: 'Groceries',
        type: 'INSTANT_SPEND',
        allocatedAmount: 100,
      })
    ).body.data;
    const res = await auth(request(app).post(`${itemsUrl(month, pot)}/${item._id}/paid`)).send({ paid: true });
    expect(res.status).toBe(422);
  });

  it('carries the due day into the next month but not the paid state', async () => {
    const { month, pot } = await setupCurrentMonth();
    const bill = (
      await auth(request(app).post(itemsUrl(month, pot))).send({
        name: 'Rent',
        type: 'INSTANT_SPEND',
        allocatedAmount: 100,
        dueDay: 1,
        isRecurring: true,
      })
    ).body.data;
    await auth(request(app).post(`${itemsUrl(month, pot)}/${bill._id}/paid`)).send({ paid: true });

    const now = new Date();
    const next = await auth(request(app).post(`/api/v1/months/${month._id}/clone`)).send({
      year: now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
      month: now.getUTCMonth() === 11 ? 1 : now.getUTCMonth() + 2,
    });
    const cloned = (await auth(request(app).get(`/api/v1/months/${next.body.data._id}`))).body.data.pots[0]
      .lineItems[0];
    expect(cloned.dueDay).toBe(1);
    expect(cloned.isPaid).toBe(false);
    expect(cloned.dueDate).toBeDefined();
  });
});

describe('Spends logged offline are never counted twice', () => {
  it('returns the existing entry when the same clientRequestId is sent again', async () => {
    const { month, pot } = await setupCurrentMonth();
    const item = (
      await auth(request(app).post(itemsUrl(month, pot))).send({
        name: 'Eating out',
        type: 'INSTANT_SPEND',
        allocatedAmount: 500,
      })
    ).body.data;
    const url = `${itemsUrl(month, pot)}/${item._id}/transactions`;
    const body = { amount: 120, date: new Date().toISOString(), clientRequestId: 'offline-abc-12345' };

    const first = await auth(request(app).post(url)).send(body);
    const again = await auth(request(app).post(url)).send(body);
    expect(first.status).toBe(201);
    expect(again.body.data._id).toBe(first.body.data._id);
    expect(again.body.data.pot.spentAmount).toBe(120); // still 120, not 240

    const log = await auth(request(app).get(`/api/v1/spend-log?monthId=${month._id}`));
    expect(log.body.data).toHaveLength(1);
  });
});
