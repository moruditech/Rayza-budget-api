const request = require('supertest');
const app = require('../../src/app');
const { connectTestDB, clearTestDB, closeTestDB } = require('../helpers/db');
const { registerAndLogin } = require('../helpers/authHelper');
const { redisClient, connectRedis, disconnectRedis } = require('../../src/config/redis');

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

/**
 * Builds month A with income, one pot, and three line items:
 *  - a SINKING_FUND ready to carry a full contribution across a clone
 *  - a recurring INSTANT_SPEND item (should survive a clone)
 *  - a non-recurring INSTANT_SPEND item (should NOT survive a clone)
 */
async function setupMonthWithLineItems() {
  const monthRes = await auth(request(app).post('/api/v1/months')).send({
    year: 2025,
    month: 1,
  });
  const month = monthRes.body.data;

  await auth(request(app).post(`/api/v1/months/${month._id}/income`)).send({
    label: 'Salary',
    amount: 10000,
  });

  const potRes = await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
    name: 'Personal Development',
    type: 'SPENDING',
    budgetLimit: 3000,
  });
  const pot = potRes.body.data;

  const sinkingRes = await auth(
    request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
  ).send({
    name: "Driver's Licence",
    type: 'SINKING_FUND',
    allocatedAmount: 500,
    targetAmount: 500,
    monthlyContribution: 500,
  });

  const recurringRes = await auth(
    request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
  ).send({ name: 'Gym', type: 'INSTANT_SPEND', allocatedAmount: 400, isRecurring: true });

  const oneOffRes = await auth(
    request(app).post(`/api/v1/months/${month._id}/pots/${pot._id}/line-items`)
  ).send({ name: 'Birthday Gift', type: 'INSTANT_SPEND', allocatedAmount: 300 });

  return {
    month,
    pot,
    sinkingItem: sinkingRes.body.data,
    recurringItem: recurringRes.body.data,
    oneOffItem: oneOffRes.body.data,
  };
}

describe('Transactions', () => {
  it('logs a transaction and recalculates the pot spentAmount/surplus', async () => {
    const { month, pot, recurringItem } = await setupMonthWithLineItems();

    const res = await auth(
      request(app).post(
        `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${recurringItem._id}/transactions`
      )
    ).send({ amount: 150, date: '2025-01-10', paymentMethod: 'CARD', note: 'Monthly gym fee' });

    expect(res.status).toBe(201);
    expect(res.body.data.pot.spentAmount).toBe(150);
    // 3000 budget - 150 spent - 500 auto-deposited into the Driver's Licence fund.
    expect(res.body.data.pot.spentAmount).toBe(150);
    expect(res.body.data.pot.committedAmount).toBe(500);
    expect(res.body.data.pot.remaining).toBe(2350);
    expect(res.body.data.pot.surplus).toBe(2350);
  });

  it('rejects logging a transaction against a SINKING_FUND line item', async () => {
    const { month, pot, sinkingItem } = await setupMonthWithLineItems();

    const res = await auth(
      request(app).post(
        `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${sinkingItem._id}/transactions`
      )
    ).send({ amount: 100, date: '2025-01-10' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WRONG_TYPE');
  });

  it('edits and deletes a transaction, recalculating the pot each time', async () => {
    const { month, pot, recurringItem } = await setupMonthWithLineItems();
    const txRes = await auth(
      request(app).post(
        `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${recurringItem._id}/transactions`
      )
    ).send({ amount: 150, date: '2025-01-10' });
    const txId = txRes.body.data._id;

    const editRes = await auth(
      request(app).patch(
        `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${recurringItem._id}/transactions/${txId}`
      )
    ).send({ amount: 200 });
    expect(editRes.status).toBe(200);
    expect(editRes.body.data.pot.spentAmount).toBe(200);

    const deleteRes = await auth(
      request(app).delete(
        `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${recurringItem._id}/transactions/${txId}`
      )
    );
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.pot.spentAmount).toBe(0);
  });
});

describe('Month clone', () => {
  it('carries SINKING_FUND balances forward (with contribution applied) and only recurring INSTANT_SPEND items', async () => {
    const { month, sinkingItem, recurringItem, oneOffItem } = await setupMonthWithLineItems();

    const cloneRes = await auth(
      request(app).post(`/api/v1/months/${month._id}/clone`)
    ).send({ year: 2025, month: 2 });
    expect(cloneRes.status).toBe(201);
    const newMonth = cloneRes.body.data;

    const detailRes = await auth(request(app).get(`/api/v1/months/${newMonth._id}`));
    const clonedItems = detailRes.body.data.pots[0].lineItems;
    const names = clonedItems.map((li) => li.name);

    expect(names).toContain(sinkingItem.name);
    expect(names).toContain(recurringItem.name);
    expect(names).not.toContain(oneOffItem.name);

    const clonedSinking = clonedItems.find((li) => li.name === sinkingItem.name);
    // The fund was created with its R500 allocation already deposited, and
    // the new month's R500 allocation is deposited on top of it.
    expect(clonedSinking.accumulatedBalance).toBe(1000);
    expect(clonedSinking.isReadyToUse).toBe(true);

    return { newMonth, clonedSinking };
  });

  it('rejects cloning into a year+month that already exists with 409 DUPLICATE', async () => {
    const { month } = await setupMonthWithLineItems();
    const res = await auth(request(app).post(`/api/v1/months/${month._id}/clone`)).send({
      year: 2025,
      month: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });
});

describe('Mark as Used', () => {
  async function cloneForward(month) {
    const cloneRes = await auth(request(app).post(`/api/v1/months/${month._id}/clone`)).send({
      year: 2025,
      month: 2,
    });
    const newMonth = cloneRes.body.data;
    const detailRes = await auth(request(app).get(`/api/v1/months/${newMonth._id}`));
    const pot = detailRes.body.data.pots[0];
    const sinkingItem = pot.lineItems.find((li) => li.type === 'SINKING_FUND');
    return { newMonth, pot, sinkingItem };
  }

  it('rejects mark-used before the target is reached', async () => {
    const { month, pot, sinkingItem } = await setupMonthWithLineItems();
    // Raise the target above the balance so the fund isn't ready yet.
    await auth(
      request(app).patch(
        `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${sinkingItem._id}`
      )
    ).send({ targetAmount: 5000 });
    const res = await auth(
      request(app).post(
        `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${sinkingItem._id}/mark-used`
      )
    ).send({ amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NOT_READY');
  });

  it('marks a ready sinking fund as used, resets the balance, and logs it in the spend log', async () => {
    const { month } = await setupMonthWithLineItems();
    const { newMonth, pot, sinkingItem } = await cloneForward(month);

    const markRes = await auth(
      request(app).post(
        `/api/v1/months/${newMonth._id}/pots/${pot._id}/line-items/${sinkingItem._id}/mark-used`
      )
    ).send({ amount: 1000, note: "Paid for driver's licence" });

    expect(markRes.status).toBe(200);
    expect(markRes.body.data.accumulatedBalance).toBe(0);
    expect(markRes.body.data.isReadyToUse).toBe(false);
    expect(markRes.body.data.cycleHistory).toHaveLength(1);

    const spendLogRes = await auth(
      request(app).get(`/api/v1/spend-log?monthId=${newMonth._id}&type=SINKING_FUND_USED`)
    );
    expect(spendLogRes.status).toBe(200);
    expect(spendLogRes.body.data).toHaveLength(1);
    expect(spendLogRes.body.data[0].amount).toBe(1000);
  });

  it('rejects an amount greater than the accumulated balance', async () => {
    const { month } = await setupMonthWithLineItems();
    const { newMonth, pot, sinkingItem } = await cloneForward(month);

    const res = await auth(
      request(app).post(
        `/api/v1/months/${newMonth._id}/pots/${pot._id}/line-items/${sinkingItem._id}/mark-used`
      )
    ).send({ amount: 9999 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_EXCEEDS_BALANCE');
  });
});

describe('Rollover and Lock', () => {
  it('rejects a SWEEP decision targeting a pot outside the month', async () => {
    const { month, pot } = await setupMonthWithLineItems();
    const res = await auth(request(app).post(`/api/v1/months/${month._id}/rollover`)).send({
      decisions: [{ potId: pot._id, action: 'SWEEP', targetPotId: '507f1f77bcf86cd799439011' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TARGET_POT');
  });

  it('locks a month, computes a health score, and blocks further writes', async () => {
    const { month, pot } = await setupMonthWithLineItems();

    const rolloverRes = await auth(
      request(app).post(`/api/v1/months/${month._id}/rollover`)
    ).send({ decisions: [{ potId: pot._id, action: 'RESET' }] });
    expect(rolloverRes.status).toBe(200);

    const lockRes = await auth(request(app).patch(`/api/v1/months/${month._id}/lock`));
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.data.isLocked).toBe(true);
    expect(typeof lockRes.body.data.healthScore).toBe('number');

    const doubleLockRes = await auth(request(app).patch(`/api/v1/months/${month._id}/lock`));
    expect(doubleLockRes.status).toBe(400);
    expect(doubleLockRes.body.error.code).toBe('ALREADY_LOCKED');

    const rolloverAfterLockRes = await auth(
      request(app).post(`/api/v1/months/${month._id}/rollover`)
    ).send({ decisions: [{ potId: pot._id, action: 'RESET' }] });
    expect(rolloverAfterLockRes.status).toBe(400);
    expect(rolloverAfterLockRes.body.error.code).toBe('MONTH_LOCKED');

    const potWriteRes = await auth(
      request(app).patch(`/api/v1/months/${month._id}/pots/${pot._id}`)
    ).send({ name: 'Renamed' });
    expect(potWriteRes.status).toBe(400);
    expect(potWriteRes.body.error.code).toBe('MONTH_LOCKED');
  });
});

describe('Spend Log', () => {
  it('filters by potId and paginates', async () => {
    const { month, pot, recurringItem } = await setupMonthWithLineItems();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await auth(
        request(app).post(
          `/api/v1/months/${month._id}/pots/${pot._id}/line-items/${recurringItem._id}/transactions`
        )
      ).send({ amount: 50, date: '2025-01-1' + i });
    }

    const res = await auth(
      request(app).get(`/api/v1/spend-log?potId=${pot._id}&page=1&limit=2`)
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(res.body.data[0].pot.name).toBe(pot.name);
  });
});
