// Email delivery through Plunk (https://useplunk.com), over HTTPS only.
//
// There is deliberately no SMTP path. Render's free plan blocks outbound SMTP,
// and the previous Gmail SMTP fallback was the main source of failed sends.
// Plunk's transactional endpoint is a single authenticated JSON POST, so it
// behaves the same in every environment.
//
// Wire format (from the Plunk API / @plunk/node client):
//   POST https://api.useplunk.com/v1/send
//   Authorization: Bearer <PLUNK_SECRET_KEY>
//   { to, subject, body, type: "html" | "markdown", from?, name?, subscribed? }
//
// @plunk/node itself is not used: it is marked deprecated on npm and only wraps
// this fetch, which we need to control (timeout, error shape, no secret logging).

const PLUNK_ENDPOINT = 'https://api.useplunk.com/v1/send';
const REQUEST_TIMEOUT_MS = 15000; // failsafe 5.1: never hang a monitor run on email

function plunkKey() {
  const key = (process.env.PLUNK_SECRET_KEY || '').trim();
  if (!key) throw new Error('Email delivery is not configured: set PLUNK_SECRET_KEY (Plunk API key).');
  return key;
}

/**
 * Accepts either "Name <alerts@domain.com>" or a bare address.
 * Plunk takes `from` and `name` as separate fields.
 */
export function parseSender(value) {
  const text = String(value || '').trim();
  if (!text) return {};
  const angled = text.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (angled) {
    const name = angled[1].replace(/^"|"$/g, '').trim();
    return { name: name || undefined, email: angled[2].trim() };
  }
  if (/^[^<>\s]+@[^<>\s]+$/.test(text)) return { email: text };
  return {};
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text -> minimal safe HTML. Never injects caller markup. */
export function textToHtml(text) {
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#111">${String(text)
    .split('\n')
    .map((line) => (line.trim() ? `<p style="margin:0 0 12px">${escapeHtml(line)}</p>` : ''))
    .join('')}</div>`;
}

async function sendViaPlunk({ to, subject, text, html }) {
  const key = plunkKey();
  const sender = parseSender(process.env.PLUNK_FROM);
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) throw new Error('Email recipient is missing.');

  const payload = {
    to: recipients,
    subject,
    body: html || textToHtml(text),
    type: 'html',
    // Transactional only: a verification or alert email must never subscribe
    // the recipient to marketing.
    subscribed: false,
  };
  if (sender.email) payload.from = sender.email;
  if (sender.name) payload.name = sender.name;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(PLUNK_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = {};
      try { detail = await res.json(); } catch { /* non-JSON error body */ }
      // Diagnostic metadata only: never the API key, recipient list or body.
      console.error('[email] Plunk send failed', {
        status: res.status,
        message: typeof detail?.message === 'string' ? detail.message.slice(0, 300) : undefined,
        error: typeof detail?.error === 'string' ? detail.error.slice(0, 300) : undefined,
      });
      throw new Error(`Plunk error ${res.status}`);
    }

    try { return await res.json(); } catch { return { ok: true }; }
  } catch (error) {
    if (error?.name === 'AbortError') {
      console.error('[email] Plunk send timed out');
      throw new Error('Plunk request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The single send interface for the whole app.
 * Callers pass { to, subject, text } (or html); delivery is Plunk.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!to || !subject || (!text && !html)) throw new Error('sendMail requires to, subject and a body.');
  return sendViaPlunk({ to, subject, text, html });
}

function appBase() {
  const base = process.env.APP_URL;
  if (!base) throw new Error('APP_URL is not configured. Set it to the deployed Crypto Vault URL.');
  return base.replace(/\/+$/, '');
}

// Better Auth builds these URLs and passes them in, already carrying the token.
// We only add the wording, so the token never appears in a log line here.
function linkLine(url, label) {
  return `${label}: ${url}`;
}

export async function sendVerificationEmail(user, url) {
  const link = url || `${appBase()}/verify-email`;
  const text = [
    `Confirm your email address for Crypto Vault.`,
    '',
    linkLine(link, 'Verify email'),
    '',
    'This link expires in 24 hours and can be used once.',
    'If you did not create a Crypto Vault account, ignore this email.',
    '',
    'Crypto Vault is watch-only. It never asks for a seed phrase or private key.',
  ].join('\n');

  return sendMail({
    to: user.email,
    subject: 'Verify your Crypto Vault email',
    text,
  });
}

// Sent when someone tries to sign up with an address that already has an
// account. Better Auth answers the sign-up with a generic success, so without
// this the real owner would never learn why "their" verification email never
// arrived.
export async function sendExistingAccountEmail(user, url) {
  const base = url || `${appBase()}/login`;
  const text = [
    'Someone tried to create a Crypto Vault account with this email address.',
    '',
    'If that was you, sign in instead:',
    `${base.replace(/\/login$/, '/login')}`,
    '',
    'Forgot your password? Use the reset link on the sign-in page.',
    '',
    'If it was not you, no action is needed. Your account and wallets are unchanged.',
  ].join('\n');

  return sendMail({
    to: user.email,
    subject: 'Crypto Vault: sign-in attempt for your account',
    text,
  });
}

export async function sendPasswordResetEmail(user, url) {
  const link = url || `${appBase()}/reset-password`;
  const text = [
    'Someone requested a password reset for your Crypto Vault account.',
    '',
    linkLine(link, 'Reset password'),
    '',
    'This link expires in 1 hour and can be used once.',
    'Signing in from other devices will be ended once the password changes.',
    'If this was not you, ignore this email: your password stays the same.',
    '',
    'Crypto Vault is watch-only. It never asks for a seed phrase or private key.',
  ].join('\n');

  return sendMail({
    to: user.email,
    subject: 'Reset your Crypto Vault password',
    text,
  });
}
