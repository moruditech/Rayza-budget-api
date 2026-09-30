const env = require('../config/env');
const logger = require('../config/logger');

// Sends email through a provider's HTTP API (no extra packages needed).
//   MAIL_PROVIDER=resend  -> https://resend.com   (needs a verified domain)
//   MAIL_PROVIDER=brevo   -> https://brevo.com    (a verified sender address is enough)
//   MAIL_PROVIDER=log     -> writes the email to the server log only
// Throws if the provider rejects the message; callers decide what to do about it.

async function sendViaResend({ to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`,
      to: [to],
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
}

async function sendViaBrevo({ to, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.MAIL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: env.MAIL_FROM_NAME, email: env.MAIL_FROM },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
}

async function sendMail(message) {
  if (env.MAIL_PROVIDER === 'log') {
    // The body holds a one-time link, so only log it outside production.
    logger.info(
      env.NODE_ENV === 'production'
        ? `Email (not sent, MAIL_PROVIDER=log): "${message.subject}"`
        : `Email to ${message.to}: "${message.subject}"\n${message.text}`
    );
    return;
  }
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) {
    throw new Error('MAIL_API_KEY and MAIL_FROM must be set to send email');
  }
  if (env.MAIL_PROVIDER === 'resend') return sendViaResend(message);
  return sendViaBrevo(message);
}

module.exports = { sendMail };
