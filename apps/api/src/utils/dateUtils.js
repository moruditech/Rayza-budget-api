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

module.exports = {
  getMonthBoundaries,
  getPreviousMonth,
  getNextMonth,
  daysSince,
  isAfterDayOfMonth,
  formatMonthLabel,
};
