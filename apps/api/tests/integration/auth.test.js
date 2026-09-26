const request = require('supertest');
const app = require('../../src/app');
const { connectTestDB, clearTestDB, closeTestDB } = require('../helpers/db');
const { redisClient, connectRedis, disconnectRedis } = require('../../src/config/redis');

const VALID_USER = {
  name: 'Jane Budgeter',
  email: 'jane@example.com',
  password: 'Str0ngPass1',
};

async function registerAndLogin(overrides = {}) {
  const user = { ...VALID_USER, ...overrides };
  await request(app).post('/api/v1/auth/register').send(user);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });
  const cookie = res.headers['set-cookie'];
  return { accessToken: res.body.data.accessToken, refreshCookie: cookie };
}

beforeAll(async () => {
  await connectTestDB();
  await connectRedis();
});

afterEach(async () => {
  await clearTestDB();
  await redisClient.flushDb();
});

afterAll(async () => {
  await closeTestDB();
  await disconnectRedis();
});

describe('POST /api/v1/auth/register', () => {
  it('registers a new user and never returns the password hash', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(VALID_USER);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe(VALID_USER.email);
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email with 409 DUPLICATE', async () => {
    await request(app).post('/api/v1/auth/register').send(VALID_USER);
    const res = await request(app).post('/api/v1/auth/register').send(VALID_USER);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('rejects a weak password with 422 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...VALID_USER, password: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct credentials, returns an access token, sets the refresh cookie', async () => {
    await request(app).post('/api/v1/auth/register').send(VALID_USER);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: VALID_USER.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
    await request(app).post('/api/v1/auth/register').send(VALID_USER);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'WrongPass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the same 401 INVALID_CREDENTIALS', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'WrongPass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('issues a new access token from the refresh cookie', async () => {
    const { refreshCookie } = await registerAndLogin();
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', refreshCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
  });

  it('rejects a missing refresh cookie with 401 TOKEN_INVALID', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('protected routes', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a malformed bearer token with 401 TOKEN_INVALID', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('blacklists the access token so it can no longer be used', async () => {
    const { accessToken } = await registerAndLogin();

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(200);

    const reuseRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe('TOKEN_REVOKED');
  });
});

describe('PATCH /api/v1/auth/password', () => {
  it('changes the password when the current password is correct', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: VALID_USER.password, newPassword: 'NewerPass1' });
    expect(res.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID_USER.email, password: 'NewerPass1' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects the wrong current password with 401 INVALID_CREDENTIALS', async () => {
    const { accessToken } = await registerAndLogin();
    const res = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'WrongPass1', newPassword: 'NewerPass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
