// The provider is chosen when env.js is first loaded, so each case loads a
// fresh copy of the mailer with its own environment and a mocked fetch.
function loadMailer(envOverrides) {
  let mailer;
  const saved = { ...process.env };
  Object.assign(process.env, envOverrides);
  jest.isolateModules(() => {
    mailer = require('../../../src/utils/mailer');
  });
  process.env = saved;
  return mailer;
}

const message = { to: 'jane@example.com', subject: 'Reset', text: 'plain', html: '<p>html</p>' };

afterEach(() => {
  delete global.fetch;
});

describe('mailer', () => {
  it('log mode sends nothing over the network', async () => {
    global.fetch = jest.fn();
    await loadMailer({ MAIL_PROVIDER: 'log' }).sendMail(message);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('Resend: posts the message with the API key', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await loadMailer({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'key123', MAIL_FROM: 'noreply@example.co.za', MAIL_FROM_NAME: 'Budget' }).sendMail(message);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers.Authorization).toBe('Bearer key123');
    expect(JSON.parse(options.body)).toMatchObject({
      from: 'Budget <noreply@example.co.za>',
      to: ['jane@example.com'],
      subject: 'Reset',
      text: 'plain',
    });
  });

  it('Brevo: posts the message with the api-key header', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    await loadMailer({ MAIL_PROVIDER: 'brevo', MAIL_API_KEY: 'key456', MAIL_FROM: 'me@example.com', MAIL_FROM_NAME: 'Budget' }).sendMail(message);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers['api-key']).toBe('key456');
    expect(JSON.parse(options.body)).toMatchObject({
      sender: { name: 'Budget', email: 'me@example.com' },
      to: [{ email: 'jane@example.com' }],
      textContent: 'plain',
    });
  });

  it('throws when the provider rejects the message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
    await expect(
      loadMailer({ MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'x', MAIL_FROM: 'a@b.co' }).sendMail(message)
    ).rejects.toThrow(/401/);
  });

  it('throws a clear error when the key or sender is missing', async () => {
    global.fetch = jest.fn();
    await expect(loadMailer({ MAIL_PROVIDER: 'brevo', MAIL_API_KEY: '', MAIL_FROM: '' }).sendMail(message)).rejects.toThrow(
      /MAIL_API_KEY and MAIL_FROM/
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
