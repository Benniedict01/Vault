// Email delivery.
//
// Preferred: Resend over HTTPS (RESEND_API_KEY + EMAIL_FROM). Works on Render's
// free plan, which blocks outbound SMTP ports.
// Fallback: classic SMTP (SMTP_HOST/USER/PASSWORD) - only works on a paid
// Render plan or another host that allows outbound SMTP.

async function sendViaResend({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY.trim();
  const from = (process.env.EMAIL_FROM || process.env.SMTP_FROM || '').trim();
  if (!from) throw new Error('EMAIL_FROM is required when RESEND_API_KEY is set.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch {}
      // Diagnostic metadata only - never log the API key or message bodies.
      console.error('[email] Resend send failed', {
        status: res.status,
        name: body?.name,
        message: typeof body?.message === 'string' ? body.message.slice(0, 300) : undefined,
      });
      throw new Error(`Resend error ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      console.error('[email] Resend send timed out');
      throw new Error('Resend request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaSmtp({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  if (!host || !user || !password) {
    throw new Error('Email delivery is not configured: set RESEND_API_KEY + EMAIL_FROM (or SMTP_HOST, SMTP_USER, SMTP_PASSWORD).');
  }
  const port = Number(process.env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('SMTP_PORT must be 465 or 587.');
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465, auth: { user, pass: password },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  });
  try {
    return await transporter.sendMail({ from: process.env.SMTP_FROM?.trim() || user, to, subject, text, html });
  } catch (error) {
    console.error('[email] SMTP send failed', {
      code: error?.code, command: error?.command, responseCode: error?.responseCode,
      response: typeof error?.response === 'string' ? error.response.slice(0, 300) : undefined,
      host, port,
    });
    throw error;
  } finally {
    transporter.close();
  }
}

export async function sendMail(message) {
  if (process.env.RESEND_API_KEY?.trim()) return sendViaResend(message);
  return sendViaSmtp(message);
}

function appBase() {
  const base = process.env.APP_URL;
  if (!base) throw new Error('APP_URL is not configured. Set it to the deployed Crypto Vault URL.');
  return base.replace(/\/$/, '');
}

export async function sendVerificationEmail(user, token) {
  const url = `${appBase()}/verify-email?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: user.email,
    subject: 'Verify your Crypto Vault email',
    text: `Verify your Crypto Vault email: ${url}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify your Crypto Vault email.</p><p><a href="${url}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendResetEmail(user, token) {
  const url = `${appBase()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: user.email,
    subject: 'Reset your Crypto Vault password',
    text: `Reset your password: ${url}\n\nThis link expires in 1 hour.`,
    html: `<p>Reset your Crypto Vault password.</p><p><a href="${url}">Reset password</a></p><p>This link expires in 1 hour.</p>`,
  });
}
