const request = require('supertest');

/** Registers and logs in a fresh user with a unique email, returns { user, accessToken }. */
async function registerAndLogin(app, overrides = {}) {
  const user = {
    name: 'Test User',
    email: `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'Str0ngPass1',
    acceptTerms: true,
    ...overrides,
  };
  await request(app).post('/api/v1/auth/register').send(user);
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });
  return { user, accessToken: res.body.data.accessToken };
}

module.exports = { registerAndLogin };
