const request = require('supertest');
const app = require('../../src/app');
const { connectTestDB, clearTestDB, closeTestDB } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/authHelper');
const { redisClient, connectRedis, disconnectRedis } = require('../../src/config/redis');
const { isAfterDayOfMonth } = require('../../src/utils/dateUtils');

let accessToken;

function auth(req) {
  return req.set('Authorization', `Bearer ${accessToken}`);
}

function currentYearMonth() {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

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

describe('Alerts', () => {
  it('returns an empty array when there is no month for the current calendar period', async () => {
    const res = await auth(request(app).get('/api/v1/alerts'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('raises POT_APPROACHING_LIMIT at 80%+ and POT_OVER_BUDGET over 100%, and does not flag a fresh month as stale', async () => {
    const { year, month } = currentYearMonth();
    const monthRes = await auth(request(app).post('/api/v1/months')).send({ year, month });
    const currentMonth = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${currentMonth._id}/income`)).send({
      label: 'Salary',
      amount: 10000,
    });

    const approachingPotRes = await auth(
      request(app).post(`/api/v1/months/${currentMonth._id}/pots`)
    ).send({ name: 'Approaching', type: 'SPENDING', budgetLimit: 1000 });
    const approachingPot = approachingPotRes.body.data;
    const overPotRes = await auth(
      request(app).post(`/api/v1/months/${currentMonth._id}/pots`)
    ).send({ name: 'Over', type: 'SPENDING', budgetLimit: 1000 });
    const overPot = overPotRes.body.data;

    const approachingItemRes = await auth(
      request(app).post(
        `/api/v1/months/${currentMonth._id}/pots/${approachingPot._id}/line-items`
      )
    ).send({ name: 'Groceries', type: 'INSTANT_SPEND', allocatedAmount: 1000 });
    const overItemRes = await auth(
      request(app).post(`/api/v1/months/${currentMonth._id}/pots/${overPot._id}/line-items`)
    ).send({ name: 'Groceries', type: 'INSTANT_SPEND', allocatedAmount: 1000 });

    await auth(
      request(app).post(
        `/api/v1/months/${currentMonth._id}/pots/${approachingPot._id}/line-items/${approachingItemRes.body.data._id}/transactions`
      )
    ).send({ amount: 850, date: new Date().toISOString() });
    await auth(
      request(app).post(
        `/api/v1/months/${currentMonth._id}/pots/${overPot._id}/line-items/${overItemRes.body.data._id}/transactions`
      )
    ).send({ amount: 1100, date: new Date().toISOString() });

    const res = await auth(request(app).get('/api/v1/alerts'));
    expect(res.status).toBe(200);

    const types = res.body.data.map((a) => a.type);
    expect(types).toContain('POT_APPROACHING_LIMIT');
    expect(types).toContain('POT_OVER_BUDGET');
    // The month (and its only transactions) were just created — never stale.
    expect(types).not.toContain('STALE_BUDGET');

    const approachingAlert = res.body.data.find((a) => a.type === 'POT_APPROACHING_LIMIT');
    expect(approachingAlert.pot._id).toBe(approachingPot._id);
    expect(approachingAlert.meta.percentUsed).toBe(85);
  });

  it('raises SINKING_FUND_READY as soon as a fund is created with target 0', async () => {
    const { year, month } = currentYearMonth();
    const monthRes = await auth(request(app).post('/api/v1/months')).send({ year, month });
    const currentMonth = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${currentMonth._id}/income`)).send({
      label: 'Salary',
      amount: 5000,
    });
    const potRes = await auth(request(app).post(`/api/v1/months/${currentMonth._id}/pots`)).send({
      name: 'Goals',
      type: 'SAVING',
      budgetLimit: 500,
    });

    // targetAmount: 0 means accumulatedBalance (starts at 0) already meets
    // it — isReadyToUse becomes true the instant the item is created.
    await auth(
      request(app).post(`/api/v1/months/${currentMonth._id}/pots/${potRes.body.data._id}/line-items`)
    ).send({
      name: 'Instant Goal',
      type: 'SINKING_FUND',
      allocatedAmount: 100,
      targetAmount: 0,
      monthlyContribution: 100,
    });

    const res = await auth(request(app).get('/api/v1/alerts'));
    const readyAlert = res.body.data.find((a) => a.type === 'SINKING_FUND_READY');
    expect(readyAlert).toBeDefined();
    expect(readyAlert.lineItem.name).toBe('Instant Goal');
  });

  it('flags UNALLOCATED_INCOME exactly when the real calendar date is after the 5th', async () => {
    const { year, month } = currentYearMonth();
    const monthRes = await auth(request(app).post('/api/v1/months')).send({ year, month });
    const currentMonth = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${currentMonth._id}/income`)).send({
      label: 'Salary',
      amount: 10000,
    });
    // No pots created — all 10000 is unallocated.

    const res = await auth(request(app).get('/api/v1/alerts'));
    const unallocatedAlert = res.body.data.find((a) => a.type === 'UNALLOCATED_INCOME');

    if (isAfterDayOfMonth(5)) {
      expect(unallocatedAlert).toBeDefined();
      expect(unallocatedAlert.meta.unallocatedAmount).toBe(10000);
    } else {
      expect(unallocatedAlert).toBeUndefined();
    }
  });
});

describe('Reports', () => {
  it('income-vs-spend sums both INSTANT_SPEND and SINKING_FUND_USED into "spent"', async () => {
    const monthRes = await auth(request(app).post('/api/v1/months')).send({
      year: 2025,
      month: 3,
    });
    const m = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${m._id}/income`)).send({
      label: 'Salary',
      amount: 8000,
    });
    const potRes = await auth(request(app).post(`/api/v1/months/${m._id}/pots`)).send({
      name: 'Lifestyle',
      type: 'SPENDING',
      budgetLimit: 2000,
    });
    const itemRes = await auth(
      request(app).post(`/api/v1/months/${m._id}/pots/${potRes.body.data._id}/line-items`)
    ).send({ name: 'Drinks', type: 'INSTANT_SPEND', allocatedAmount: 500 });
    await auth(
      request(app).post(
        `/api/v1/months/${m._id}/pots/${potRes.body.data._id}/line-items/${itemRes.body.data._id}/transactions`
      )
    ).send({ amount: 300, date: '2025-03-05' });

    const res = await auth(request(app).get('/api/v1/reports/income-vs-spend?months=1'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ month: 'Mar 2025', income: 8000, spent: 300 });
  });

  it('spending-by-pot requires monthId and returns per-pot totals', async () => {
    const missingRes = await auth(request(app).get('/api/v1/reports/spending-by-pot'));
    expect(missingRes.status).toBe(422);

    const monthRes = await auth(request(app).post('/api/v1/months')).send({
      year: 2025,
      month: 4,
    });
    const m = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${m._id}/income`)).send({
      label: 'Salary',
      amount: 5000,
    });
    await auth(request(app).post(`/api/v1/months/${m._id}/pots`)).send({
      name: 'Groceries',
      type: 'SPENDING',
      budgetLimit: 1500,
    });

    const res = await auth(request(app).get(`/api/v1/reports/spending-by-pot?monthId=${m._id}`));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ pot: 'Groceries', budgetLimit: 1500, spentAmount: 0 }]);
  });

  it('category-breakdown computes percentOfIncome per pot type', async () => {
    const monthRes = await auth(request(app).post('/api/v1/months')).send({
      year: 2025,
      month: 5,
    });
    const m = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${m._id}/income`)).send({
      label: 'Salary',
      amount: 10000,
    });
    await auth(request(app).post(`/api/v1/months/${m._id}/pots`)).send({
      name: 'Lifestyle',
      type: 'SPENDING',
      budgetLimit: 4000,
    });
    await auth(request(app).post(`/api/v1/months/${m._id}/pots`)).send({
      name: 'Emergency Fund',
      type: 'SAVING',
      budgetLimit: 1000,
    });

    const res = await auth(
      request(app).get(`/api/v1/reports/category-breakdown?monthId=${m._id}`)
    );
    expect(res.status).toBe(200);
    const spending = res.body.data.find((row) => row.type === 'SPENDING');
    const saving = res.body.data.find((row) => row.type === 'SAVING');
    expect(spending).toMatchObject({ totalBudget: 4000, percentOfIncome: 40 });
    expect(saving).toMatchObject({ totalBudget: 1000, percentOfIncome: 10 });
  });

  it('health-history only includes locked months', async () => {
    const monthRes = await auth(request(app).post('/api/v1/months')).send({
      year: 2025,
      month: 6,
    });
    const m = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${m._id}/income`)).send({
      label: 'Salary',
      amount: 5000,
    });

    const beforeLockRes = await auth(request(app).get('/api/v1/reports/health-history?months=1'));
    expect(beforeLockRes.body.data).toEqual([]);

    await auth(request(app).patch(`/api/v1/months/${m._id}/lock`));

    const afterLockRes = await auth(request(app).get('/api/v1/reports/health-history?months=1'));
    expect(afterLockRes.body.data).toHaveLength(1);
    expect(afterLockRes.body.data[0].month).toBe('Jun 2025');
    expect(typeof afterLockRes.body.data[0].score).toBe('number');
  });

  it('sinking-fund-progress tracks the same-named fund across a clone', async () => {
    const monthRes = await auth(request(app).post('/api/v1/months')).send({
      year: 2025,
      month: 7,
    });
    const m = monthRes.body.data;
    await auth(request(app).post(`/api/v1/months/${m._id}/income`)).send({
      label: 'Salary',
      amount: 5000,
    });
    const potRes = await auth(request(app).post(`/api/v1/months/${m._id}/pots`)).send({
      name: 'Goals',
      type: 'SAVING',
      budgetLimit: 1000,
    });
    await auth(
      request(app).post(`/api/v1/months/${m._id}/pots/${potRes.body.data._id}/line-items`)
    ).send({
      name: 'New Laptop',
      type: 'SINKING_FUND',
      allocatedAmount: 500,
      targetAmount: 2000,
      monthlyContribution: 500,
    });

    await auth(request(app).post(`/api/v1/months/${m._id}/clone`)).send({
      year: 2025,
      month: 8,
    });

    const res = await auth(
      request(app).get('/api/v1/reports/sinking-fund-progress?months=2')
    );
    expect(res.status).toBe(200);
    const fund = res.body.data.find((row) => row.lineItem === 'New Laptop');
    expect(fund).toBeDefined();
    expect(fund.target).toBe(2000);
    expect(fund.history).toEqual([
      { month: 'Jul 2025', balance: 0 },
      { month: 'Aug 2025', balance: 500 },
    ]);
  });
});

describe('Month ready to lock alert', () => {
  it('alerts for an unlocked month that has already ended, and stops once it is locked', async () => {
    const monthRes = await auth(request(app).post('/api/v1/months')).send({ year: 2020, month: 1 });
    const month = monthRes.body.data;

    const before = await auth(request(app).get('/api/v1/alerts'));
    const alert = before.body.data.find((a) => a.type === 'MONTH_READY_TO_LOCK');
    expect(alert.message).toBe('January is ready to lock');
    expect(alert.meta.monthId).toBe(month._id);

    await auth(request(app).patch(`/api/v1/months/${month._id}/lock`));
    const after = await auth(request(app).get('/api/v1/alerts'));
    expect(after.body.data.find((a) => a.type === 'MONTH_READY_TO_LOCK')).toBeUndefined();
  });
});
