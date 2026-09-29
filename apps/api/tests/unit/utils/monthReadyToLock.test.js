const { isMonthReadyToLock, getMonthName } = require('../../../src/utils/dateUtils');

describe('isMonthReadyToLock', () => {
  const at = (iso) => new Date(iso);

  it('is not ready before the last 3 days of the month', () => {
    expect(isMonthReadyToLock(2026, 9, 3, at('2026-09-27T23:59:59Z'))).toBe(false);
  });

  it('is ready from the 28th of a 30-day month', () => {
    expect(isMonthReadyToLock(2026, 9, 3, at('2026-09-28T00:00:00Z'))).toBe(true);
    expect(isMonthReadyToLock(2026, 9, 3, at('2026-09-30T23:00:00Z'))).toBe(true);
  });

  it('stays ready once the month has ended, including across a year boundary', () => {
    expect(isMonthReadyToLock(2026, 9, 3, at('2026-11-15T00:00:00Z'))).toBe(true);
    expect(isMonthReadyToLock(2025, 12, 3, at('2026-01-02T00:00:00Z'))).toBe(true);
  });

  it('handles February in a leap and non-leap year', () => {
    expect(isMonthReadyToLock(2028, 2, 3, at('2028-02-26T00:00:00Z'))).toBe(false);
    expect(isMonthReadyToLock(2028, 2, 3, at('2028-02-27T00:00:00Z'))).toBe(true);
    expect(isMonthReadyToLock(2027, 2, 3, at('2027-02-26T00:00:00Z'))).toBe(true);
  });

  it('names months in full', () => {
    expect(getMonthName(9)).toBe('September');
  });
});
