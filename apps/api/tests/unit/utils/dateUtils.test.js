const {
  getMonthBoundaries,
  getPreviousMonth,
  getNextMonth,
  daysSince,
  isAfterDayOfMonth,
} = require('../../../src/utils/dateUtils');

describe('dateUtils', () => {
  describe('getMonthBoundaries', () => {
    it('returns the first and last instant of the given month', () => {
      const { start, end } = getMonthBoundaries(2025, 9);
      expect(start.toISOString()).toBe('2025-09-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2025-09-30T23:59:59.999Z');
    });

    it('handles a 31-day month and December correctly', () => {
      const { start, end } = getMonthBoundaries(2025, 12);
      expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2025-12-31T23:59:59.999Z');
    });

    it('handles February in a leap year correctly', () => {
      const { end } = getMonthBoundaries(2028, 2);
      expect(end.toISOString()).toBe('2028-02-29T23:59:59.999Z');
    });
  });

  describe('getPreviousMonth', () => {
    it('rolls back a month within the same year', () => {
      expect(getPreviousMonth(2025, 9)).toEqual({ year: 2025, month: 8 });
    });

    it('rolls back across a year boundary', () => {
      expect(getPreviousMonth(2025, 1)).toEqual({ year: 2024, month: 12 });
    });
  });

  describe('getNextMonth', () => {
    it('rolls forward a month within the same year', () => {
      expect(getNextMonth(2025, 9)).toEqual({ year: 2025, month: 10 });
    });

    it('rolls forward across a year boundary', () => {
      expect(getNextMonth(2025, 12)).toEqual({ year: 2026, month: 1 });
    });
  });

  describe('daysSince', () => {
    it('returns 0 for a date earlier today', () => {
      const earlierToday = new Date();
      earlierToday.setHours(earlierToday.getHours() - 1);
      expect(daysSince(earlierToday)).toBe(0);
    });

    it('returns 5 for a date exactly 5 days ago', () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      expect(daysSince(fiveDaysAgo)).toBe(5);
    });
  });

  describe('isAfterDayOfMonth', () => {
    it('returns false for a day-of-month in the future', () => {
      expect(isAfterDayOfMonth(32)).toBe(false);
    });

    it('returns true for a day-of-month of 0 (always in the past)', () => {
      expect(isAfterDayOfMonth(0)).toBe(true);
    });
  });
});
