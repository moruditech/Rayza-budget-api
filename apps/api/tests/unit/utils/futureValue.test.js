const {
  monthsUntil,
  futureValueOfContributions,
  futureValueOfBalance,
  projectFund,
  requiredMonthlyContribution,
  goalProgress,
} = require('../../../src/utils/futureValue');

describe('futureValue', () => {
  it('matches FV = P × [((1 + r)^n − 1) / r] with a monthly rate of annual / 12', () => {
    // R1000 / month, 12% p.a. (1% monthly), 12 months -> 1000 × 12.6825
    expect(futureValueOfContributions(1000, 12, 12)).toBeCloseTo(12682.5, 1);
  });

  it('falls back to P × n when the rate is 0', () => {
    expect(futureValueOfContributions(500, 0, 10)).toBe(5000);
  });

  it('counts whole months to the target date, never negative', () => {
    const from = new Date('2026-01-15T00:00:00Z');
    expect(monthsUntil('2026-07-15T00:00:00Z', from)).toBe(6);
    expect(monthsUntil('2026-07-14T00:00:00Z', from)).toBe(5);
    expect(monthsUntil('2025-01-01T00:00:00Z', from)).toBe(0);
  });

  it('returns null when there is no rate or no target date', () => {
    expect(projectFund({ balance: 100, monthlyContribution: 100 })).toBeNull();
    expect(projectFund({ balance: 100, monthlyContribution: 100, annualInterestRate: 5 })).toBeNull();
  });

  it('projects balance growth plus contributions and reports the interest earned', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const p = projectFund(
      { balance: 0, monthlyContribution: 1000, annualInterestRate: 12, targetDate: '2027-01-01T00:00:00Z' },
      now
    );
    expect(p.months).toBe(12);
    expect(p.projectedFutureValue).toBeCloseTo(12682.5, 1);
    expect(p.projectedInterest).toBeCloseTo(682.5, 1);
  });
});

describe('requiredMonthlyContribution', () => {
  it('is (target - balance) / months for a fund with no interest', () => {
    expect(
      requiredMonthlyContribution({ balance: 2000, targetAmount: 14000, annualInterestRate: null, months: 12 })
    ).toBe(1000);
  });

  it('is the future value formula solved for P: paying it lands on the target', () => {
    const args = { balance: 6000, targetAmount: 144000, annualInterestRate: 8, months: 30 };
    const p = requiredMonthlyContribution(args);
    const reached =
      futureValueOfContributions(p, 8, 30) + futureValueOfBalance(6000, 8, 30);
    expect(reached).toBeGreaterThanOrEqual(144000);
    expect(reached).toBeLessThan(144000 + 5); // rounded up to the cent, so barely over
  });

  it('needs less per month when the fund earns interest', () => {
    const base = { balance: 0, targetAmount: 50000, months: 24 };
    const plain = requiredMonthlyContribution({ ...base, annualInterestRate: null });
    const earning = requiredMonthlyContribution({ ...base, annualInterestRate: 10 });
    expect(earning).toBeLessThan(plain);
  });

  it('is 0 once the balance alone will grow past the target', () => {
    expect(
      requiredMonthlyContribution({ balance: 10000, targetAmount: 9000, annualInterestRate: null, months: 6 })
    ).toBe(0);
  });

  it('asks for the whole gap when the goal date is now or past', () => {
    expect(
      requiredMonthlyContribution({ balance: 1000, targetAmount: 5000, annualInterestRate: null, months: 0 })
    ).toBe(4000);
  });
});

describe('goalProgress', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const base = { balance: 0, targetAmount: 12000, targetDate: '2027-01-01T00:00:00Z' };

  it('returns null without a target amount or a goal date', () => {
    expect(goalProgress({ balance: 0, monthlyContribution: 100 }, now)).toBeNull();
    expect(goalProgress({ ...base, targetDate: null, monthlyContribution: 100 }, now)).toBeNull();
  });

  it('is ON_TRACK when the monthly amount covers what is needed', () => {
    const p = goalProgress({ ...base, monthlyContribution: 1000 }, now);
    expect(p.status).toBe('ON_TRACK');
    expect(p.requiredMonthly).toBe(1000);
    expect(p.projectedAtGoalDate).toBe(12000);
  });

  it('is BEHIND with the exact monthly shortfall', () => {
    const p = goalProgress({ ...base, monthlyContribution: 800 }, now);
    expect(p.status).toBe('BEHIND');
    expect(p.shortfall).toBe(200);
  });

  it('is REACHED once the balance is at or above the target', () => {
    const p = goalProgress({ ...base, balance: 12000, monthlyContribution: 0 }, now);
    expect(p.status).toBe('REACHED');
  });
});
