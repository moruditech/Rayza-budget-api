/**
 * One-off migration for data created BEFORE sinking-fund allocations became
 * automatic deposits.
 *
 * Before: a fund's accumulatedBalance stayed at R0 until the month was cloned.
 * Now:    a fund's allocation is deposited the moment it is created.
 *
 * This deposits the allocation into every SINKING_FUND in an UNLOCKED month
 * that has never received a deposit (balance 0, no withdrawals). Locked months
 * are left alone. Safe to re-run: funds that already hold a balance are skipped.
 *
 * Usage (from apps/api):  node scripts/backfillSinkingFundDeposits.js [--dry-run]
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const LineItem = require('../src/models/LineItem.model');
const Month = require('../src/models/Month.model');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGO_URI);

  const unlockedMonthIds = await Month.find({ isLocked: false }).distinct('_id');
  const funds = await LineItem.find({
    type: 'SINKING_FUND',
    monthId: { $in: unlockedMonthIds },
    accumulatedBalance: 0,
    'cycleHistory.0': { $exists: false },
    allocatedAmount: { $gt: 0 },
  });

  for (const fund of funds) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${fund.name}: +${fund.allocatedAmount}`);
    if (!dryRun) {
      fund.accumulatedBalance = fund.allocatedAmount;
      // eslint-disable-next-line no-await-in-loop
      await fund.save();
    }
  }

  console.log(`${funds.length} fund(s) ${dryRun ? 'would be' : ''} updated.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
