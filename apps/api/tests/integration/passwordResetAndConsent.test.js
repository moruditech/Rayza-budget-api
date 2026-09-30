const request = require('supertest');
const crypto = require('crypto');
const app = require('../../src/app');
const User = require('../../src/models/User.model');
const PasswordReset = require('../../src/models/PasswordReset.model');
const mailer = require('../../src/utils/mailer');
const authService = require('../../src/modules/auth/auth.service');
const { LEGAL_VERSION } = require('@budget-app/shared');
const { connectTestDB, clearTestDB, closeTestDB } = require('../helpers/db');
const { redisClient, connectRedis, disconnectRedis } = require('../../src/config/redis');

const USER = { name: 'Jane', email: 'jane@example.com', password: 'Str0ngPass1', acceptTerms: true };

let sendMail;
beforeAll(async () => {
  await connectTestDB();
  await connectRedis();
});
beforeEach(() => {
  sendMail = jest.spyOn(mailer, 'sendMail').mockResolvedValue();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearTestDB();
  await redisClient.flushDb();
});
afterAll(async () => {
  await closeTestDB();
  await disconnectRedis();
});

const register = (body = USER) => request(app).post('/api/v1/auth/register').send(body);
const login = (password = USER.password) =>
  request(app).post('/api/v1/auth/login').send({ email: USER.email, password });

// The link in the email holds the raw token; pull it out like a person clicking it.
const tokenFromLastEmail = () => {
  const { text } = sendMail.mock.calls.at(-1)[0];
  return text.match(/token=([a-f0-9]{64})/)[1];
};

describe('Consent at registration', () => {
  it('refuses to register without accepting the terms', async () => {
    const res = await register({ ...USER, acceptTerms: false });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await User.countDocuments()).toBe(0);

    const { acceptTerms, ...withoutFlag } = USER;
    expect((await register(withoutFlag)).status).toBeGreaterThanOrEqual(400);
  });

  it('records which version was accepted and when', async () => {
    await register();
    const user = await User.findOne({ email: USER.email });
    expect(user.consentVersion).toBe(LEGAL_VERSION);
    expect(user.consentAt).toBeInstanceOf(Date);
  });

  it('GET /auth/me reports whether consent is needed, and POST /auth/consent clears it', async () => {
    await register();
    const { accessToken } = (await login()).body.data;
    const auth = (r) => r.set('Authorization', `Bearer ${accessToken}`);

    expect((await auth(request(app).get('/api/v1/auth/me'))).body.data.consentRequired).toBe(false);

    // An older account, or terms that changed since: consent is needed again.
    await User.updateOne({ email: USER.email }, { consentVersion: null, consentAt: null });
    const me = await auth(request(app).get('/api/v1/auth/me'));
    expect(me.body.data).toMatchObject({ consentRequired: true, email: USER.email, legalVersion: LEGAL_VERSION });
    expect(me.body.data.passwordHash).toBeUndefined();

    const accepted = await auth(request(app).post('/api/v1/auth/consent')).send({ accept: true });
    expect(accepted.body.data.consentRequired).toBe(false);
    expect((await auth(request(app).post('/api/v1/auth/consent')).send({ accept: false })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('Forgot / reset password', () => {
  it('answers the same for a known and an unknown email', async () => {
    await register();
    const known = await request(app).post('/api/v1/auth/forgot-password').send({ email: USER.email });
    const unknown = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
  });

  it('emails a one-time link, stores only a hash, and lets the new password work', async () => {
    await register();
    await authService.forgotPassword(USER.email);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe(USER.email);
    const token = tokenFromLastEmail();
    const row = await PasswordReset.findOne();
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));

    const reset = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassw0rd9' });
    expect(reset.status).toBeLessThan(300);
    expect((await login('NewPassw0rd9')).status).toBe(200);
    expect((await login()).status).toBe(401);

    // One use only.
    const again = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Another0ne1' });
    expect(again.status).toBe(400);
  });

  it('sends nothing for an unknown email, and only one email per minute', async () => {
    await register();
    await authService.forgotPassword('nobody@example.com');
    expect(sendMail).not.toHaveBeenCalled();

    await authService.forgotPassword(USER.email);
    await authService.forgotPassword(USER.email);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('only the newest link works', async () => {
    await register();
    await authService.forgotPassword(USER.email);
    const first = tokenFromLastEmail();
    await PasswordReset.updateMany({}, { createdAt: new Date(Date.now() - 5 * 60 * 1000) }); // get past the cooldown
    await authService.forgotPassword(USER.email);
    const second = tokenFromLastEmail();

    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: first, password: 'NewPassw0rd9' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: second, password: 'NewPassw0rd9' })).status).toBeLessThan(300);
  });

  it('rejects expired, malformed and weak-password requests', async () => {
    await register();
    await authService.forgotPassword(USER.email);
    const token = tokenFromLastEmail();

    expect((await request(app).post('/api/v1/auth/reset-password').send({ token: 'abc', password: 'NewPassw0rd9' })).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'short' })).status).toBeGreaterThanOrEqual(400);

    await PasswordReset.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    const expired = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassw0rd9' });
    expect(expired.status).toBe(400);
    expect((await login()).status).toBe(200); // old password untouched
  });

  it('signs out sessions that existed before the reset', async () => {
    await register();
    const first = await login();
    const oldCookie = first.headers['set-cookie'];

    await new Promise((r) => setTimeout(r, 1100)); // JWT times have 1-second resolution
    await authService.forgotPassword(USER.email);
    await request(app).post('/api/v1/auth/reset-password').send({ token: tokenFromLastEmail(), password: 'NewPassw0rd9' });

    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(refreshed.status).toBe(401);

    const fresh = await request(app).post('/api/v1/auth/login').send({ email: USER.email, password: 'NewPassw0rd9' });
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', fresh.headers['set-cookie'])).status).toBe(200);
  });

  it('still resets the password when the email provider fails afterwards', async () => {
    await register();
    await authService.forgotPassword(USER.email);
    const token = tokenFromLastEmail();
    sendMail.mockRejectedValue(new Error('provider down'));
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'NewPassw0rd9' });
    expect(res.status).toBeLessThan(300);
    expect((await login('NewPassw0rd9')).status).toBe(200);
  });
});
