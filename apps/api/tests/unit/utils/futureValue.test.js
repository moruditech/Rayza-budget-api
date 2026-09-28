const {
  monthsUntil,
  futureValueOfContributions,
  projectFund,
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
