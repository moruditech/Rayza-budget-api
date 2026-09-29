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

async function setup() {
  const month = (await auth(request(app).post('/api/v1/months')).send({ year: 2026, month: 9 }))
    .body.data;
  await auth(request(app).post(`/api/v1/months/${month._id}/income`)).send({
    label: 'Salary',
    amount: 20000,
  });
  const pot = (
    await auth(request(app).post(`/api/v1/months/${month._id}/pots`)).send({
      name: 'Build Home',
      type: 'SAVING',
      budgetLimit: 6000,
    })
  ).body.data;
  return { month, pot };
}

const itemsUrl = (month, pot) => `/api/v1/months/${month._id}/pots/${pot._id}/line-items`;

async function createFund(month, pot, body) {
  return auth(request(app).post(itemsUrl(month, pot))).send({
    type: 'SINKING_FUND',
    monthlyContribution: undefined,
    ...body,
  });
}

async function getPot(month, pot) {
  const res = await auth(request(app).get(`/api/v1/months/${month._id}`));
  return res.body.data.pots.find((p) => p._id === pot._id);
}

describe('Sinking fund allocation', () => {
  it('deposits the allocation immediately and uses it up in the pot', async () => {
    const { month, pot } = await setup();
    const res = await createFund(month, pot, {
      name: 'Cash Built',
      allocatedAmount: 6000,
      targetAmount: 144000,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.accumulatedBalance).toBe(6000);
    expect(res.body.data.monthlyContribution).toBe(6000);

    const detail = await getPot(month, pot);
    expect(detail.committedAmount).toBe(6000);
    expect(detail.remaining).toBe(0);
  });

  it('keeps balance and pot in step when the allocation is edited', async () => {
    const { month, pot } = await setup();
    const fund = (
      await createFund(month, pot, { name: 'Fund', allocatedAmount: 2000, targetAmount: 10000 })
    ).body.data;

    const res = await auth(request(app).patch(`${itemsUrl(month, pot)}/${fund._id}`)).send({
      allocatedAmount: 3000,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.accumulatedBalance).toBe(3000);
    expect((await getPot(month, pot)).remaining).toBe(3000);
  });
});

describe('Interest projection', () => {
  it('projects the future value only when a rate and target date are given', async () => {
    const { month, pot } = await setup();
    const plain = (
      await createFund(month, pot, { name: 'Bank', allocatedAmount: 500, targetAmount: 5000 })
    ).body.data;
    expect(plain.projection).toBeNull();
    expect(plain.annualInterestRate).toBeNull();

    const target = new Date();
    target.setUTCFullYear(target.getUTCFullYear() + 1);
    const earning = (
      await createFund(month, pot, {
        name: 'Capitec',
        allocatedAmount: 500,
        targetAmount: 50000,
        annualInterestRate: 12,
        targetDate: target.toISOString(),
      })
    ).body.data;
    expect(earning.projection.months).toBeGreaterThanOrEqual(11);
    expect(earning.projectedFutureValue).toBeGreaterThan(500 + 500 * earning.projection.months);
  });

  it('rejects a rate without a target date', async () => {
    const { month, pot } = await setup();
    const res = await createFund(month, pot, {
      name: 'Capitec',
      allocatedAmount: 500,
      targetAmount: 5000,
      annualInterestRate: 8,
    });
    expect(res.status).toBe(422);
  });
});

describe('Withdraw', () => {
  it('withdraws before the target, reduces the balance and logs it', async () => {
    const { month, pot } = await setup();
    const fund = (
      await createFund(month, pot, { name: 'Cash Built', allocatedAmount: 3000, targetAmount: 144000 })
    ).body.data;

    const res = await auth(request(app).post(`${itemsUrl(month, pot)}/${fund._id}/withdraw`)).send({
      amount: 1000,
      note: 'House plan',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.accumulatedBalance).toBe(2000);

    const log = await auth(
      request(app).get(`/api/v1/spend-log?monthId=${month._id}&type=SINKING_FUND_USED`)
    );
    expect(log.body.data).toHaveLength(1);
    expect(log.body.data[0].amount).toBe(1000);

    // Pot budget is untouched by a withdrawal.
    expect((await getPot(month, pot)).committedAmount).toBe(3000);
  });

  it('rejects withdrawing more than the balance', async () => {
    const { month, pot } = await setup();
    const fund = (
      await createFund(month, pot, { name: 'F', allocatedAmount: 500, targetAmount: 5000 })
    ).body.data;
    const res = await auth(request(app).post(`${itemsUrl(month, pot)}/${fund._id}/withdraw`)).send({
      amount: 501,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_EXCEEDS_BALANCE');
  });
});

describe('Transfers', () => {
  it('moves money between funds and reflects on both', async () => {
    const { month, pot } = await setup();
    const a = (await createFund(month, pot, { name: 'Emergency', allocatedAmount: 3000, targetAmount: 9000 })).body.data;
    const b = (await createFund(month, pot, { name: 'Personal', allocatedAmount: 1000, targetAmount: 9000 })).body.data;

    const res = await auth(request(app).post(`/api/v1/months/${month._id}/transfers`)).send({
      fromLineItemId: a._id,
      toLineItemId: b._id,
      amount: 1500,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.from.accumulatedBalance).toBe(1500);
    expect(res.body.data.to.accumulatedBalance).toBe(2500);

    const outLog = await auth(request(app).get(`/api/v1/spend-log?monthId=${month._id}&type=TRANSFER_OUT`));
    const inLog = await auth(request(app).get(`/api/v1/spend-log?monthId=${month._id}&type=TRANSFER_IN`));
    expect(outLog.body.data).toHaveLength(1);
    expect(inLog.body.data).toHaveLength(1);

    // Each side of the transfer says where the money came from / went to.
    expect(inLog.body.data[0].counterparty).toMatchObject({ lineItemName: 'Emergency', potName: 'Build Home' });
    expect(outLog.body.data[0].counterparty).toMatchObject({ lineItemName: 'Personal' });

    // The fund history and the pot totals reflect it too.
    const detail = await getPot(month, pot);
    const personal = detail.lineItems.find((li) => li.name === 'Personal');
    expect(personal.activity[0]).toMatchObject({
      type: 'TRANSFER_IN',
      amount: 1500,
      counterparty: { lineItemName: 'Emergency' },
    });
    expect(detail.transferredIn).toBe(1500);
    expect(detail.transferredOut).toBe(1500);
  });

  it('rejects same-fund and over-balance transfers', async () => {
    const { month, pot } = await setup();
    const a = (await createFund(month, pot, { name: 'A', allocatedAmount: 500, targetAmount: 9000 })).body.data;
    const b = (await createFund(month, pot, { name: 'B', allocatedAmount: 500, targetAmount: 9000 })).body.data;
    const url = `/api/v1/months/${month._id}/transfers`;

    const same = await auth(request(app).post(url)).send({ fromLineItemId: a._id, toLineItemId: a._id, amount: 10 });
    expect(same.body.error.code).toBe('SAME_FUND');

    const over = await auth(request(app).post(url)).send({ fromLineItemId: a._id, toLineItemId: b._id, amount: 501 });
    expect(over.body.error.code).toBe('AMOUNT_EXCEEDS_BALANCE');
  });
});

describe('Invest remaining pot budget into an existing fund', () => {
  it('tops up the fund from what is left in the pot, and caps it at that amount', async () => {
    const { month, pot } = await setup();
    const fund = (
      await createFund(month, pot, { name: 'Cash Built', allocatedAmount: 5000, targetAmount: 144000 })
    ).body.data;
    const url = `${itemsUrl(month, pot)}/${fund._id}/deposit`;

    const tooMuch = await auth(request(app).post(url)).send({ amount: 1001 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('ALLOCATION_EXCEEDED');

    const res = await auth(request(app).post(url)).send({ amount: 800, note: 'Leftover' });
    expect(res.status).toBe(200);
    expect(res.body.data.lineItem.accumulatedBalance).toBe(5800);
    expect(res.body.data.lineItem.extraDeposited).toBe(800);
    expect(res.body.data.pot.remaining).toBe(200);

    const detail = await getPot(month, pot);
    expect(detail.committedAmount).toBe(5800);
    expect(detail.remaining).toBe(200);
    expect(detail.transferredIn).toBe(0);

    const log = await auth(
      request(app).get(`/api/v1/spend-log?monthId=${month._id}&type=SINKING_FUND_DEPOSIT`)
    );
    expect(log.body.data).toHaveLength(1);
  });

  it('does not repeat the one-off top-up in the next month', async () => {
    const { month, pot } = await setup();
    const fund = (
      await createFund(month, pot, { name: 'Cash Built', allocatedAmount: 5000, targetAmount: 144000 })
    ).body.data;
    await auth(request(app).post(`${itemsUrl(month, pot)}/${fund._id}/deposit`)).send({ amount: 1000 });

    const clone = await auth(request(app).post(`/api/v1/months/${month._id}/clone`)).send({
      year: 2026,
      month: 10,
    });
    expect(clone.status).toBe(201);

    const nextPot = (await auth(request(app).get(`/api/v1/months/${clone.body.data._id}`))).body.data
      .pots[0];
    const nextFund = nextPot.lineItems[0];
    // 5000 + 1000 carried over, plus October's 5000 allocation.
    expect(nextFund.accumulatedBalance).toBe(11000);
    expect(nextFund.extraDeposited).toBe(0);
    expect(nextPot.committedAmount).toBe(5000);
    expect(nextPot.remaining).toBe(1000);
  });
});
