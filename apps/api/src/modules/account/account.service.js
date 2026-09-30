const bcrypt = require('bcrypt');
const { ERROR_CODES } = require('@budget-app/shared');
const User = require('../../models/User.model');
const Month = require('../../models/Month.model');
const Income = require('../../models/Income.model');
const Pot = require('../../models/Pot.model');
const LineItem = require('../../models/LineItem.model');
const SpendLog = require('../../models/SpendLog.model');
const PasswordReset = require('../../models/PasswordReset.model');
const ApiError = require('../../utils/ApiError');
const tokenService = require('../../services/token.service');

// Right of access (POPIA s23): everything the app holds about the person, in a
// machine-readable file. The password hash is never included.
async function exportData(userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw new ApiError(404, 'User not found', null, ERROR_CODES.NOT_FOUND);

  const filter = { userId };
  const [months, income, pots, lineItems, spendLog] = await Promise.all([
    Month.find(filter).sort({ year: 1, month: 1 }).lean(),
    Income.find(filter).lean(),
    Pot.find(filter).lean(),
    LineItem.find(filter).lean(),
    SpendLog.find(filter).sort({ date: 1 }).lean(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    account: {
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      acceptedTermsVersion: user.consentVersion,
      acceptedTermsAt: user.consentAt,
    },
    months,
    income,
    pots,
    lineItems,
    spendLog,
  };
}

// Right to deletion (POPIA s24): permanently removes the account and every
// record that belongs to it. The password is asked for again so a stolen,
// still-open session cannot wipe the account. Children go first and the user
// last, so a failure part-way can simply be retried.
async function deleteAccount(userId, password, accessToken, decoded) {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found', null, ERROR_CODES.NOT_FOUND);

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new ApiError(401, 'Password is incorrect', null, ERROR_CODES.INVALID_CREDENTIALS);
  }

  const filter = { userId: user._id };
  await Promise.all([
    SpendLog.deleteMany(filter),
    LineItem.deleteMany(filter),
    Pot.deleteMany(filter),
    Income.deleteMany(filter),
    PasswordReset.deleteMany(filter),
  ]);
  await Month.deleteMany(filter);
  await User.deleteOne({ _id: user._id });

  // The access token stops working now; the refresh token already fails
  // because the user no longer exists.
  await tokenService.blacklistToken(accessToken, decoded);
}

module.exports = { exportData, deleteAccount };
