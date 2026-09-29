/**
 * Future value maths for interest-bearing sinking funds.
 *
 * The rate is a FIXED ANNUAL percentage entered per fund (never defaulted).
 * Contributions are monthly, so the periodic rate is r = annual / 12.
 *
 * Contributions: FV = P × [((1 + r)^n − 1) / r]      (r = 0  ->  P × n)
 * Existing balance also earns interest: FV = B × (1 + r)^n
 */

const round2 = (value) => Math.round(value * 100) / 100;

/** Whole calendar months from `from` until `target` (never negative). */
function monthsUntil(target, from = new Date()) {
  const t = new Date(target);
  let months =
    (t.getUTCFullYear() - from.getUTCFullYear()) * 12 + (t.getUTCMonth() - from.getUTCMonth());
  if (t.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** FV = P × [((1 + r)^n − 1) / r] with r = annualRatePercent / 100 / 12. */
function futureValueOfContributions(payment, annualRatePercent, months) {
  const r = annualRatePercent / 100 / 12;
  if (months <= 0) return 0;
  if (r === 0) return payment * months;
  return payment * ((Math.pow(1 + r, months) - 1) / r);
}

/** Growth of the balance already in the fund: B × (1 + r)^n. */
function futureValueOfBalance(balance, annualRatePercent, months) {
  const r = annualRatePercent / 100 / 12;
  return balance * Math.pow(1 + r, months);
}

/**
 * Projection for one sinking fund, or null when it earns no interest or has
 * no target date to project to.
 */
function projectFund({ balance = 0, monthlyContribution = 0, annualInterestRate, targetDate }, now = new Date()) {
  if (annualInterestRate == null || !targetDate) return null;

  const months = monthsUntil(targetDate, now);
  const contributionsFV = futureValueOfContributions(monthlyContribution, annualInterestRate, months);
  const balanceFV = futureValueOfBalance(balance, annualInterestRate, months);
  const projectedFutureValue = contributionsFV + balanceFV;
  const totalPaidIn = balance + monthlyContribution * months;

  return {
    months,
    annualInterestRate,
    targetDate,
    contributionsFV: round2(contributionsFV),
    balanceFV: round2(balanceFV),
    projectedFutureValue: round2(projectedFutureValue),
    totalPaidIn: round2(totalPaidIn),
    projectedInterest: round2(projectedFutureValue - totalPaidIn),
  };
}

const ceil2 = (value) => Math.ceil(value * 100 - 1e-9) / 100;

/**
 * Monthly amount needed to reach `targetAmount` by the goal date, i.e. the
 * future value formula solved for P:
 *
 *   P = (Target − B × (1 + r)^n) / [((1 + r)^n − 1) / r]      (r = 0 -> (Target − B) / n)
 *
 * with r = annual / 100 / 12 (0 for funds that earn no interest).
 */
function requiredMonthlyContribution({ balance, targetAmount, annualInterestRate, months }) {
  const rate = annualInterestRate == null ? 0 : annualInterestRate;
  const r = rate / 100 / 12;
  const stillNeeded = targetAmount - balance * Math.pow(1 + r, months);
  if (stillNeeded <= 0) return 0;
  if (months <= 0) return ceil2(targetAmount - balance); // due now
  const perUnit = r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
  return ceil2(stillNeeded / perUnit);
}

/**
 * "Am I on track?" for a sinking fund with a target amount and a goal date.
 * Returns null when either is missing. `monthlyContribution` is what the
 * person actually puts in each month.
 *
 * status: REACHED | ON_TRACK | BEHIND
 */
function goalProgress(
  { balance = 0, monthlyContribution = 0, targetAmount, annualInterestRate, targetDate },
  now = new Date()
) {
  if (targetAmount == null || !targetDate) return null;

  const months = monthsUntil(targetDate, now);
  const rate = annualInterestRate == null ? 0 : annualInterestRate;

  const projectedAtGoalDate = round2(
    futureValueOfContributions(monthlyContribution, rate, months) +
      futureValueOfBalance(balance, rate, months)
  );

  if (balance >= targetAmount) {
    return { status: 'REACHED', months, requiredMonthly: 0, currentMonthly: monthlyContribution, shortfall: 0, projectedAtGoalDate, goalDate: targetDate };
  }

  const requiredMonthly = requiredMonthlyContribution({
    balance,
    targetAmount,
    annualInterestRate,
    months,
  });
  const shortfall = round2(Math.max(0, requiredMonthly - monthlyContribution));

  return {
    status: shortfall > 0.005 ? 'BEHIND' : 'ON_TRACK',
    months,
    requiredMonthly,
    currentMonthly: monthlyContribution,
    shortfall,
    projectedAtGoalDate,
    goalDate: targetDate,
  };
}

module.exports = {
  requiredMonthlyContribution,
  goalProgress,
  monthsUntil,
  futureValueOfContributions,
  futureValueOfBalance,
  projectFund,
};
