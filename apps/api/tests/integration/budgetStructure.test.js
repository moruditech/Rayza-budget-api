const request = require('supertest');
const app = require('../../src/app');
const { connectTestDB, clearTestDB, closeTestDB } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/authHelper');
const { redisClient, connectRedis, disconnectRedis } = require('../../src/config/redis');
const Month = require('../../src/models/Month.model');

let accessToken;

function auth(req) {
  return req.set('Authorization', `Bearer ${accessToken}`);
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

async function createMonth(year = 2025, month = 11) {
  const res = await auth(request(app).post('/api/v1/months')).send({ year, month });
  return res.body.data;
}

describe('Months', () => {
  it('creates a month and lists it with a computed summary', async () => {
    await createMonth();

    const listRes = await auth(request(app).get('/api/v1/months'));
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0]).toMatchObject({
      year: 2025,
      month: 11,
      totalIncome: 0,
      totalBudgetLimit: 0,
      unallocatedIncome: 0,
      potCount: 0,
    });
  });

  it('rejects a duplicate year+month with 409 DUPLICATE', async () => {
    await createMonth();
    const res = await auth(request(app).post('/api/v1/months')).send({ year: 2025, month: 11 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('404s on a month belonging to another user', async () => {
    const month = await createMonth();
    const { accessToken: otherToken } = await registerAndLogin(app);
    const res = await request(app)
      .get(`/api/v1/months/${month._id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('Income', () => {
  it('adds income sources and reflects the total', async () => {
    const month = await createMonth();
    await auth(request(app).post(`/api/v1/months/${month._id}/income`)).send({
      label: 'Salary',
      amount: 10000,
    });
    const res = await auth(
      request(app).post(`/api/v1/months/${month._id}/income`)
    ).send({ label: 'Freelance', amount: 2000 });

    expect(res.status).toBe(201);

    const detail = await auth(request(app).get(`/api/v1/months/${month._id}`));
    expect(detail.body.data.totalIncome).toBe(12000);
    expect(detail.body.data.income).toHaveLength(2);
  });

  it('rejects reducing income below existing pot Budget Limits', async () => {
    const month = await createMonth();
    const incomeRes = await auth(
      request(app).post(`/api/v1/months/${month._id}/income`)
    ).send({ label: 'Salary', amount: 10000 });
    const incomeId = incomeRes.body.data._id;

    await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Lifestyle',
      type: 'SPENDING',
      budgetLimit: 6000,
    });

    const res = await auth(
      request(app).patch(`/api/v1/months/${month._id}/income/${incomeId}`)
    ).send({ amount: 3000 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INCOME_BELOW_ALLOCATIONS');
  });
});

describe('Pots', () => {
  async function withIncome(monthId, amount = 12000) {
    await auth(request(app).post(`/api/v1/months/${monthId}/income`)).send({
      label: 'Salary',
      amount,
    });
  }

  it('creates a pot within income and computes surplus', async () => {
    const month = await createMonth();
    await withIncome(month._id);

    const res = await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Lifestyle & Entertainment',
      type: 'SPENDING',
      budgetLimit: 5000,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.spentAmount).toBe(0);
    expect(res.body.data.surplus).toBe(5000);
  });

  it('rejects a pot whose Budget Limit would exceed Total Monthly Income', async () => {
    const month = await createMonth();
    await withIncome(month._id, 5000);

    const res = await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Too Big',
      type: 'SPENDING',
      budgetLimit: 6000,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BUDGET_EXCEEDED');
  });

  it('re-checks BUDGET_EXCEEDED on update only when budgetLimit changes', async () => {
    const month = await createMonth();
    await withIncome(month._id, 5000);
    const potRes = await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Lifestyle',
      type: 'SPENDING',
      budgetLimit: 5000,
    });
    const potId = potRes.body.data._id;

    const renameRes = await auth(
      request(app).patch(`/api/v1/months/${month._id}/pots/${potId}`)
    ).send({ name: 'Lifestyle & Fun' });
    expect(renameRes.status).toBe(200);

    const overBudgetRes = await auth(
      request(app).patch(`/api/v1/months/${month._id}/pots/${potId}`)
    ).send({ budgetLimit: 6000 });
    expect(overBudgetRes.status).toBe(400);
    expect(overBudgetRes.body.error.code).toBe('BUDGET_EXCEEDED');
  });

  it('deletes a pot and cascades to its line items', async () => {
    const month = await createMonth();
    await withIncome(month._id);
    const potRes = await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Lifestyle',
      type: 'SPENDING',
      budgetLimit: 2000,
    });
    const potId = potRes.body.data._id;

    await auth(
      request(app).post(`/api/v1/months/${month._id}/pots/${potId}/line-items`)
    ).send({ name: 'Drinks', type: 'INSTANT_SPEND', allocatedAmount: 500 });

    const deleteRes = await auth(request(app).delete(`/api/v1/months/${month._id}/pots/${potId}`));
    expect(deleteRes.status).toBe(200);

    const lineItemsRes = await auth(
      request(app).get(`/api/v1/months/${month._id}/pots/${potId}/line-items`)
    );
    expect(lineItemsRes.status).toBe(404);
  });
});

describe('Line Items', () => {
  async function setupPot(budgetLimit = 2000) {
    const month = await createMonth();
    await auth(request(app).post(`/api/v1/months/${month._id}/income`)).send({
      label: 'Salary',
      amount: 12000,
    });
    const potRes = await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Personal Development',
      type: 'SPENDING',
      budgetLimit,
    });
    return { month, pot: potRes.body.data };
  }

  it('rejects a SINKING_FUND item missing target/monthly fields', async () => {
    const { month, pot } = await setupPot();
    const res = await auth(
      request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
    ).send({ name: 'Driver\u2019s Licence', type: 'SINKING_FUND', allocatedAmount: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SINKING_FUND_FIELDS');
  });

  it('rejects an INSTANT_SPEND item that sends sinking-fund fields', async () => {
    const { month, pot } = await setupPot();
    const res = await auth(
      request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
    ).send({
      name: 'Books',
      type: 'INSTANT_SPEND',
      allocatedAmount: 400,
      targetAmount: 1000,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FIELDS_FOR_TYPE');
  });

  it('creates line items and computes SINKING_FUND progress', async () => {
    const { month, pot } = await setupPot();
    const res = await auth(
      request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
    ).send({
      name: 'Online Short Course',
      type: 'SINKING_FUND',
      allocatedAmount: 800,
      targetAmount: 3200,
      monthlyContribution: 800,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.isReadyToUse).toBe(false);
    expect(res.body.data.progress).toBe(0);
    expect(res.body.data.spentAmount).toBeUndefined();
  });

  it('rejects allocations that exceed the pot Budget Limit', async () => {
    const { month, pot } = await setupPot(1000);
    await auth(
      request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
    ).send({ name: 'Books', type: 'INSTANT_SPEND', allocatedAmount: 600 });

    const res = await auth(
      request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
    ).send({ name: 'Workshops', type: 'INSTANT_SPEND', allocatedAmount: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ALLOCATION_EXCEEDED');
  });
});

describe('MONTH_LOCKED guard', () => {
  // No /lock endpoint exists yet (Phase 4) — flip isLocked directly to
  // simulate a locked month and confirm every write path blocks it.
  it('blocks writes on a locked month with 400 MONTH_LOCKED', async () => {
    const month = await createMonth();
    await auth(request(app).post(`/api/v1/months/${month._id}/income`)).send({
      label: 'Salary',
      amount: 10000,
    });
    const potRes = await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Lifestyle',
      type: 'SPENDING',
      budgetLimit: 2000,
    });
    const potId = potRes.body.data._id;

    await Month.updateOne({ _id: month._id }, { $set: { isLocked: true } });

    const incomeRes = await auth(
      request(app).post(`/api/v1/months/${month._id}/income`)
    ).send({ label: 'Bonus', amount: 500 });
    expect(incomeRes.status).toBe(400);
    expect(incomeRes.body.error.code).toBe('MONTH_LOCKED');

    const potWriteRes = await auth(
      request(app).patch(`/api/v1/months/${month._id}/pots/${potId}`)
    ).send({ budgetLimit: 1500 });
    expect(potWriteRes.status).toBe(400);
    expect(potWriteRes.body.error.code).toBe('MONTH_LOCKED');

    const lineItemRes = await auth(
      request(app).post(`/api/v1/months/${month._id}/pots/${potId}/line-items`)
    ).send({ name: 'Groceries', type: 'INSTANT_SPEND', allocatedAmount: 500 });
    expect(lineItemRes.status).toBe(400);
    expect(lineItemRes.body.error.code).toBe('MONTH_LOCKED');
  });
});
