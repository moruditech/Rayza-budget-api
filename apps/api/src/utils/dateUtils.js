/**
 * Get the first and last instant of a given year/month (UTC).
 * @param {number} year
 * @param {number} month - 1-indexed (1 = January), matching the Month model.
 */
function getMonthBoundaries(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

/** Roll a { year, month } pair back one month, wrapping across a year boundary. */
function getPreviousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Roll a { year, month } pair forward one month, wrapping across a year boundary. */
function getNextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Whole days elapsed since `date` (used for the "no spend logged in 5+ days" alert). */
function daysSince(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/** True if today's calendar day (UTC) is after the given day-of-month. */
function isAfterDayOfMonth(day) {
  return new Date().getUTCDate() > day;
}

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Apr 2025" style label for a { year, month } pair (1-indexed), matching the API Contract's report examples. */
function formatMonthLabel(year, month) {
  return `${MONTH_ABBREVIATIONS[month - 1]} ${year}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Full month name for a 1-indexed month number, e.g. 9 -> "September". */
function getMonthName(month) {
  return MONTH_NAMES[month - 1];
}

/**
 * True once `now` is within the last `daysBeforeEnd` days of the given
 * { year, month } (1-indexed), or anywhere after that month has ended.
 * e.g. September with daysBeforeEnd = 3 -> ready from 28 Sep onwards.
 */
function isMonthReadyToLock(year, month, daysBeforeEnd = 3, now = new Date()) {
  // Day 0 of the following month is the last day of `month`, so counting
  // back from day 1 of the following month gives the start of the window.
  const windowStart = Date.UTC(year, month, 1 - daysBeforeEnd);
  return now.getTime() >= windowStart;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** UTC midnight of the day a bill is due in { year, month } (1-indexed); a due day of 31 in a 30-day month becomes the 30th. */
function dueDateFor(year, month, dueDay) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(dueDay, lastDay)));
}

/** Whole days from `from` to `to` (negative when `to` is earlier), ignoring the time of day. */
function daysBetweenUtc(from, to) {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / MS_PER_DAY);
}

module.exports = {
  dueDateFor,
  daysBetweenUtc,
  getMonthName,
  isMonthReadyToLock,
  getMonthBoundaries,
  getPreviousMonth,
  getNextMonth,
  daysSince,
  isAfterDayOfMonth,
  formatMonthLabel,
};
