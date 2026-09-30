const request = require('supertest');
const app = require('../../src/app');
const Month = require('../../src/models/Month.model');
const alertsService = require('../../src/modules/alerts/alerts.service');
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

const createMonth = async (year, month) =>
  (await auth(request(app).post('/api/v1/months')).send({ year, month })).body.data;
const createPot = async (month, body) =>
  (await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send(body)).body.data;
const createItem = async (month, pot, body) =>
  (await auth(request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)).send(body))
    .body.data;
const logSpend = (month, pot, item, body) =>
  auth(request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items/${item._id}/transactions`)).send({
    paymentMethod: 'CARD',
    date: new Date().toISOString(),
    ...body,
  });

describe('Leftover alert', () => {
  // evaluateLeftoverAlerts takes "now" so the last-3-days window can be tested on any day.
  it('suggests the fund furthest behind, capped at what it still needs', async () => {
    const month = await createMonth(2020, 1);
    const pot = await createPot(month, { name: 'Build Home', type: 'INVESTMENT', budgetLimit: 6000 });
    await createItem(month, pot, { name: 'Almost there', type: 'SINKING_FUND', allocatedAmount: 2000, targetAmount: 2300 });
    await createItem(month, pot, { name: 'Cash Built', type: 'SINKING_FUND', allocatedAmount: 1000, targetAmount: 144000 });
    const doc = await Month.findById(month._id);

    const alerts = await alertsService.evaluateLeftoverAlerts(doc.userId, doc, new Date('2020-01-29T10:00:00Z'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toBe('R 3 000 left in Build Home');
    expect(alerts[0].meta).toMatchObject({ lineItemName: 'Cash Built', suggestedAmount: 3000, remaining: 3000 });
  });

  it('caps the suggestion at what the fund still needs', async () => {
    const month = await createMonth(2020, 1);
    const pot = await createPot(month, { name: 'Build Home', type: 'INVESTMENT', budgetLimit: 6000 });
    await createItem(month, pot, { name: 'Tablet', type: 'SINKING_FUND', allocatedAmount: 2000, targetAmount: 2400 });
    const doc = await Month.findById(month._id);

    const [alert] = await alertsService.evaluateLeftoverAlerts(doc.userId, doc, new Date('2020-01-30T10:00:00Z'));
    expect(alert.meta.suggestedAmount).toBe(400);
  });

  it('stays quiet earlier in the month, when locked, or with no fund to put it in', async () => {
    const month = await createMonth(2020, 1);
    const pot = await createPot(month, { name: 'Build Home', type: 'INVESTMENT', budgetLimit: 6000 });
    await createItem(month, pot, { name: 'Cash Built', type: 'SINKING_FUND', allocatedAmount: 1000, targetAmount: 144000 });
    await createPot(month, { name: 'Food', type: 'SPENDING', budgetLimit: 1000 }); // leftover but no fund
    const doc = await Month.findById(month._id);

    expect(await alertsService.evaluateLeftoverAlerts(doc.userId, doc, new Date('2020-01-20T10:00:00Z'))).toHaveLength(0);
    const late = await alertsService.evaluateLeftoverAlerts(doc.userId, doc, new Date('2020-01-29T10:00:00Z'));
    expect(late.map((a) => a.meta.lineItemName)).toEqual(['Cash Built']); // not Food
    doc.isLocked = true;
    expect(await alertsService.evaluateLeftoverAlerts(doc.userId, doc, new Date('2020-01-29T10:00:00Z'))).toHaveLength(0);
  });
});

describe('Activity search and amount filters', () => {
  async function seed() {
    const month = await createMonth(2026, 9);
    const pot = await createPot(month, { name: 'Lifestyle', type: 'SPENDING', budgetLimit: 5000 });
    const eating = await createItem(month, pot, { name: 'Eating out', type: 'INSTANT_SPEND', allocatedAmount: 1000 });
    const data = await createItem(month, pot, { name: 'Data & Minutes', type: 'INSTANT_SPEND', allocatedAmount: 500 });
    await logSpend(month, pot, eating, { amount: 120, note: 'Nando\'s' });
    await logSpend(month, pot, eating, { amount: 350 });
    await logSpend(month, pot, data, { amount: 299 });
    return month;
  }
  const query = async (month, qs) =>
    (await auth(request(app).get(`/api/v1/spend-log?monthId=${month._id}&${qs}`))).body.data;

  it('finds entries by line item name, note or pot name, ignoring case', async () => {
    const month = await seed();
    expect(await query(month, 'search=eating')).toHaveLength(2);
    expect(await query(month, 'search=NANDO')).toHaveLength(1);
    expect(await query(month, 'search=lifestyle')).toHaveLength(3);
    expect(await query(month, 'search=data %26 min')).toHaveLength(1); // "data & min"
    expect(await query(month, 'search=nothing')).toHaveLength(0);
  });

  it('filters by minimum and maximum amount, and combines with search', async () => {
    const month = await seed();
    expect(await query(month, 'minAmount=200')).toHaveLength(2);
    expect(await query(month, 'maxAmount=299')).toHaveLength(2);
    expect(await query(month, 'minAmount=100&maxAmount=300')).toHaveLength(2);
    const both = await query(month, 'search=eating&minAmount=200');
    expect(both).toHaveLength(1);
    expect(both[0].amount).toBe(350);
  });
});

describe('Pot comparison report', () => {
  it('compares each pot with the same pot last month, matched by name', async () => {
    const sep = await createMonth(2026, 9);
    const sepFood = await createPot(sep, { name: 'Food', type: 'SPENDING', budgetLimit: 2000 });
    const sepItem = await createItem(sep, sepFood, { name: 'Groceries', type: 'INSTANT_SPEND', allocatedAmount: 2000 });
    await logSpend(sep, sepFood, sepItem, { amount: 800 });
    await createPot(sep, { name: 'Old pot', type: 'SPENDING', budgetLimit: 100 });

    const oct = await createMonth(2026, 10);
    const octFood = await createPot(oct, { name: ' food ', type: 'SPENDING', budgetLimit: 2000 });
    const octItem = await createItem(oct, octFood, { name: 'Groceries', type: 'INSTANT_SPEND', allocatedAmount: 2000 });
    await logSpend(oct, octFood, octItem, { amount: 1000 });
    await createPot(oct, { name: 'New pot', type: 'SPENDING', budgetLimit: 100 });

    const res = await auth(request(app).get(`/api/v1/reports/pot-comparison?monthId=${oct._id}`));
    expect(res.status).toBe(200);
    expect(res.body.data.previousMonth).toEqual({ year: 2026, month: 9 });

    const byName = Object.fromEntries(res.body.data.pots.map((p) => [p.name.trim().toLowerCase(), p]));
    expect(byName.food.current.used).toBe(1000);
    expect(byName.food.previous.used).toBe(800);
    expect(byName.food.usedChange).toBe(200);
    expect(byName.food.usedChangePercent).toBe(25);
    expect(byName['new pot'].previous).toBeNull();
    expect(byName['old pot'].current).toBeNull();
  });

  it('has no previous month for the first month', async () => {
    const first = await createMonth(2026, 1);
    const res = await auth(request(app).get(`/api/v1/reports/pot-comparison?monthId=${first._id}`));
    expect(res.body.data.previousMonth).toBeNull();
    expect(res.body.data.totals.previous).toBeNull();
  });
});
