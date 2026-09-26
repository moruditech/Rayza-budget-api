const bcrypt = require('bcrypt');
const { ERROR_CODES } = require('@budget-app/shared');
const User = require('../../models/User.model');
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
  const user = await User.create({ name, email, passwordHash });
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

module.exports = { register, login, refresh, logout, changePassword };
