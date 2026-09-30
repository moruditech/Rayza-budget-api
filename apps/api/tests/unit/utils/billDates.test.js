const { dueDateFor, daysBetweenUtc } = require('../../../src/utils/dateUtils');

describe('dueDateFor', () => {
  it('returns the due day of the month at UTC midnight', () => {
    expect(dueDateFor(2026, 10, 25).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('clamps a day that does not exist in short months', () => {
    expect(dueDateFor(2026, 9, 31).toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(dueDateFor(2027, 2, 30).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(dueDateFor(2028, 2, 30).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
});

describe('daysBetweenUtc', () => {
  it('counts calendar days and ignores the time of day', () => {
    expect(daysBetweenUtc(new Date('2026-10-01T23:59:00Z'), new Date('2026-10-04T00:00:00Z'))).toBe(3);
    expect(daysBetweenUtc(new Date('2026-10-04T08:00:00Z'), new Date('2026-10-04T00:00:00Z'))).toBe(0);
  });

  it('is negative when the target day has passed', () => {
    expect(daysBetweenUtc(new Date('2026-10-10T00:00:00Z'), new Date('2026-10-05T00:00:00Z'))).toBe(-5);
  });
});
