// Resend HTTPS provider adapter.
//
// Sends transactional email over HTTPS — no SMTP ports, which Render's free
// plan blocks. The adapter's only job is to talk to one provider and translate
// its failures into EmailError codes.

import { EmailError, EMAIL_ERROR_CODES } from '../errors';

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15000;

function redactRecipient(to) {
  // Log-friendly recipient: keep the domain, mask the local part.
  const at = String(to || '').lastIndexOf('@');
  if (at <= 0) return '<redacted>';
  return `<redacted>@${to.slice(at + 1)}`;
}

export const resendAdapter = Object.freeze({
  name: 'Resend',

  /**
   * @param {{ to: string, from: string, subject: string, text: string, html: string }} message
   * @returns {Promise<{ messageId: string|null }>}
   */
  async send({ to, from, subject, text, html }) {
    const apiKey = (process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) {
      throw new EmailError(
        EMAIL_ERROR_CODES.EMAIL_NOT_CONFIGURED,
        'RESEND_API_KEY is not set; email delivery is disabled.'
      );
    }
    if (!from) {
      throw new EmailError(
        EMAIL_ERROR_CODES.INVALID_SENDER,
        'EMAIL_FROM is not set; cannot send email without a verified sender.'
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') {
        throw new EmailError(
          EMAIL_ERROR_CODES.EMAIL_PROVIDER_TIMEOUT,
          'Resend request timed out',
          { providerName: 'Resend', cause: err }
        );
      }
      throw new EmailError(
        EMAIL_ERROR_CODES.NETWORK_ERROR,
        'Could not reach the Resend API',
        { providerName: 'Resend', cause: err }
      );
    }
    clearTimeout(timer);

    if (res.ok) {
      let body = {};
      try { body = await res.json(); } catch { /* body is optional */ }
      return { messageId: typeof body?.id === 'string' ? body.id : null };
    }

    // Map provider failures onto the taxonomy. Provider payloads are reduced to
    // a short code/message before logging — never the API key or full bodies.
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    const providerName = typeof body?.name === 'string' ? body.name : undefined;
    const providerMessage = typeof body?.message === 'string' ? body.message.slice(0, 300) : undefined;
    const detail = `Resend error status=${res.status} name=${providerName || 'unknown'}`;

    if (res.status === 401 || res.status === 403) {
      throw new EmailError(EMAIL_ERROR_CODES.INVALID_API_KEY, detail, { providerStatus: res.status, providerName: 'Resend' });
    }
    if (res.status === 429) {
      throw new EmailError(EMAIL_ERROR_CODES.RATE_LIMITED, detail, { providerStatus: res.status, providerName: 'Resend' });
    }
    if (res.status === 422 && /from|sender|domain/i.test(`${providerName} ${providerMessage}`)) {
      throw new EmailError(EMAIL_ERROR_CODES.INVALID_SENDER, `${detail} message=${providerMessage}`, { providerStatus: res.status, providerName: 'Resend' });
    }
    throw new EmailError(
      EMAIL_ERROR_CODES.EMAIL_PROVIDER_ERROR,
      providerMessage ? `${detail} message=${providerMessage}` : detail,
      { providerStatus: res.status, providerName: 'Resend' }
    );
  },
});

export { redactRecipient };
