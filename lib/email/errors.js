// Structured email-error taxonomy.
//
// Callers catch EmailError and map `code` to a friendly user message via
// `userMessage()`. Raw provider details stay in server logs only.

export const EMAIL_ERROR_CODES = Object.freeze({
  EMAIL_NOT_CONFIGURED: 'EMAIL_NOT_CONFIGURED',
  EMAIL_PROVIDER_ERROR: 'EMAIL_PROVIDER_ERROR',
  EMAIL_PROVIDER_TIMEOUT: 'EMAIL_PROVIDER_TIMEOUT',
  INVALID_SENDER: 'INVALID_SENDER',
  INVALID_API_KEY: 'INVALID_API_KEY',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_EMAIL_ERROR: 'UNKNOWN_EMAIL_ERROR',
});

const FRIENDLY = {
  EMAIL_NOT_CONFIGURED: 'Email delivery is not configured on this server yet. Please try again later.',
  EMAIL_PROVIDER_ERROR: "We couldn't send the email. Please try again.",
  EMAIL_PROVIDER_TIMEOUT: 'The email service took too long to respond. Please try again.',
  INVALID_SENDER: "We couldn't send the email. Please try again.",
  INVALID_API_KEY: "We couldn't send the email. Please try again.",
  RATE_LIMITED: 'Too many email requests. Please wait a minute and try again.',
  NETWORK_ERROR: "We couldn't reach the email service. Please try again.",
  UNKNOWN_EMAIL_ERROR: "We couldn't send the email. Please try again.",
};

export class EmailError extends Error {
  /**
   * @param {string} code one of EMAIL_ERROR_CODES
   * @param {string} message developer-facing detail (safe to log, never secrets)
   * @param {{ cause?: unknown, providerStatus?: number, providerName?: string }} [meta]
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'EmailError';
    this.code = EMAIL_ERROR_CODES[code] || EMAIL_ERROR_CODES.UNKNOWN_EMAIL_ERROR;
    this.providerStatus = meta.providerStatus;
    this.providerName = meta.providerName;
    if (meta.cause) this.cause = meta.cause;
  }
}

export function userMessage(error) {
  const code = error instanceof EmailError ? error.code : 'UNKNOWN_EMAIL_ERROR';
  return FRIENDLY[code] || FRIENDLY.UNKNOWN_EMAIL_ERROR;
}

export function isEmailError(error) {
  return error instanceof EmailError;
}
