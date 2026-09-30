const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { ERROR_CODES, LEGAL_VERSION } = require('@budget-app/shared');
const env = require('../../config/env');
const logger = require('../../config/logger');
const User = require('../../models/User.model');
const PasswordReset = require('../../models/PasswordReset.model');
const mailer = require('../../utils/mailer');
const ApiError = require('../../utils/ApiError');
const tokenService = require('../../services/token.service');

const SALT_ROUNDS = 12;

// Precomputed once at module load (a one-time synchronous cost at server
// startup, not per-request) and reused whenever login() finds no matching
// user — see the comment in login() for why.
const DUMMY_HASH = bcrypt.hashSync('no-such-user-timing-safety-placeholder', SALT_ROUNDS);

// FR-01 — register with name, email, password. Passwords are hashed with
// bcrypt before storage; the duplicate-email case is left to the User
// model's unique index — a violation surfaces as a Mongo 11000 error, which
// the global error handler already maps to 409 DUPLICATE.
async function register({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  // The schema only lets a request through when acceptTerms was true, so the
  // current versions were accepted at this moment.
  const user = await User.create({
    name,
    email,
    passwordHash,
    consentVersion: LEGAL_VERSION,
    consentAt: new Date(),
  });
  return { _id: user._id, name: user.name, email: user.email };
}

// FR-01 — login, returns an access token + refresh token pair. The same
// error is thrown whether the email doesn't exist or the password is
// wrong, so the response body never reveals which emails are registered.
// Just as importantly, bcrypt.compare always runs — against the user's
// real hash if one was found, against a fixed dummy hash of the same cost
// factor if not — so the two cases also take the same amount of time.
// Returning early on `!user` (skipping bcrypt.compare entirely) would
// otherwise make "no such email" measurably faster than "wrong password",
// letting an attacker enumerate registered emails purely from response
// latency despite the identical error message and status code.
async function login({ email, password }) {
  const user = await User.findOne({ email });
  const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
  const isMatch = await bcrypt.compare(password, hashToCompare);

  if (!user || !isMatch) {
    throw new ApiError(
      401,
      'Email or password is incorrect',
      null,
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  const userId = user._id.toString();
  return {
    accessToken: tokenService.signAccessToken(userId),
    refreshToken: tokenService.signRefreshToken(userId),
  };
}

// FR-01 — rotate the access token using the refresh cookie.
async function refresh(refreshToken) {
  if (!refreshToken) {
    throw new ApiError(401, 'Refresh token is missing', null, ERROR_CODES.TOKEN_INVALID);
  }

  const decoded = tokenService.verifyRefreshToken(refreshToken);

  // A deleted account shouldn't be able to keep minting access tokens off
  // an old refresh token.
  const user = await User.findById(decoded.userId);
  if (!user) {
    throw new ApiError(401, 'Refresh token is invalid', null, ERROR_CODES.TOKEN_INVALID);
  }

  // A password reset signs out every other device: refresh tokens issued
  // before it are no longer accepted.
  if (
    user.sessionsValidAfter &&
    decoded.iat < Math.floor(user.sessionsValidAfter.getTime() / 1000)
  ) {
    throw new ApiError(401, 'Session ended, please log in again', null, ERROR_CODES.TOKEN_INVALID);
  }

  return { accessToken: tokenService.signAccessToken(user._id.toString()) };
}

// FR-01 — blacklist the current access token. `decoded` is req.user, the
// already-verified payload attached by the authenticate middleware.
async function logout(accessToken, decoded) {
  await tokenService.blacklistToken(accessToken, decoded);
}

// FR-01 — change password. Requires the current password to be re-entered.
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found', null, ERROR_CODES.NOT_FOUND);
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    throw new ApiError(
      401,
      'Current password is incorrect',
      null,
      ERROR_CODES.INVALID_CREDENTIALS
    );
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await user.save();
}

// The signed-in person's basic details and whether they still need to accept
// the current Terms / Privacy Policy.
async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found', null, ERROR_CODES.NOT_FOUND);
  }
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    consentVersion: user.consentVersion,
    consentAt: user.consentAt,
    consentRequired: user.consentVersion !== LEGAL_VERSION,
    legalVersion: LEGAL_VERSION,
  };
}

async function acceptConsent(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found', null, ERROR_CODES.NOT_FOUND);
  }
  user.consentVersion = LEGAL_VERSION;
  user.consentAt = new Date();
  await user.save();
  return getMe(userId);
}

// ── Forgot / reset password ────────────────────────────────────────────────
const RESET_TOKEN_MINUTES = 30;
const RESET_COOLDOWN_SECONDS = 60;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function resetEmail(name, link) {
  const text =
    `Hi ${name},\n\n` +
    `Use this link to choose a new password. It works once and expires in ${RESET_TOKEN_MINUTES} minutes:\n\n` +
    `${link}\n\n` +
    'If you did not ask for this, ignore this email. Your password stays the same.';
  const html =
    `<p>Hi ${escapeHtml(name)},</p>` +
    `<p>Use this link to choose a new password. It works once and expires in ${RESET_TOKEN_MINUTES} minutes.</p>` +
    `<p><a href="${link}">Choose a new password</a></p>` +
    '<p>If you did not ask for this, ignore this email. Your password stays the same.</p>';
  return { subject: 'Reset your password', text, html };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Sends a reset link to `email` if an account exists. It does the same thing
 * from the caller's point of view either way (the controller does not wait for
 * it), so the response never reveals which emails are registered. A second
 * request within a minute is ignored so the endpoint cannot be used to flood
 * someone's inbox.
 */
async function forgotPassword(email) {
  const user = await User.findOne({ email });
  if (!user) return;

  const recent = await PasswordReset.findOne({
    userId: user._id,
    createdAt: { $gt: new Date(Date.now() - RESET_COOLDOWN_SECONDS * 1000) },
  });
  if (recent) return;

  // Only the newest link works.
  await PasswordReset.deleteMany({ userId: user._id });

  const token = crypto.randomBytes(32).toString('hex');
  await PasswordReset.create({
    userId: user._id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000),
  });

  const link = `${env.CLIENT_URL.replace(/\/$/, '')}/reset-password?token=${token}`;
  await mailer.sendMail({ to: user.email, ...resetEmail(user.name, link) });
}

// Sets a new password from a reset link, then ends every other session.
async function resetPassword({ token, password }) {
  const invalid = () =>
    new ApiError(400, 'This reset link is invalid or has expired', null, ERROR_CODES.TOKEN_INVALID);

  // Claim the token atomically so two requests cannot both use it.
  const record = await PasswordReset.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() }
  );
  if (!record) throw invalid();

  const user = await User.findById(record.userId);
  if (!user) throw invalid();

  user.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  user.sessionsValidAfter = new Date();
  await user.save();
  await PasswordReset.deleteMany({ userId: user._id });

  // Tell the owner, in case it wasn't them. A mail failure must not undo the reset.
  mailer
    .sendMail({
      to: user.email,
      subject: 'Your password was changed',
      text: `Hi ${user.name},\n\nYour password was just changed using a reset link. If this was not you, reset it again and contact us.`,
      html: `<p>Hi ${escapeHtml(user.name)},</p><p>Your password was just changed using a reset link. If this was not you, reset it again and contact us.</p>`,
    })
    .catch((err) => logger.error(`Password-changed email failed: ${err.message}`));
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  changePassword,
  getMe,
  acceptConsent,
  forgotPassword,
  resetPassword,
};
