// Logging helpers.
//
// Rules taken from the engineering brief:
//   - never log passwords, tokens, API keys, session cookies or email bodies
//   - wallet addresses are masked (first 6 / last 4 characters)
//   - every error is logged with a reason and the affected unit
//
// Nothing in here touches the database or the network, so it can be unit
// tested (see tests/).

/** Mask a wallet address: 0x1234…cdef */
export function maskAddress(value) {
  if (typeof value !== 'string') return '…';
  const v = value.trim();
  if (!v) return '…';
  if (v.length <= 12) return `${v.slice(0, 2)}…`;
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

/** Mask an email address: al…@example.com */
export function maskEmail(value) {
  if (typeof value !== 'string') return '…';
  const v = value.trim();
  if (!v) return '…';
  const at = v.lastIndexOf('@');
  if (at <= 0) return maskAddress(v);
  return `${v.slice(0, 2)}…${v.slice(at)}`;
}

/**
 * Strip anything that looks like personal data out of a provider error
 * message before it is written to the database or the logs.
 */
export function sanitizeReason(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b0x[0-9a-fA-F]{40,}\b/g, '[address]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Keep only the host of a URL, so endpoint lists are never logged in full. */
export function safeEndpoint(value) {
  try {
    return new URL(value).host;
  } catch {
    return 'unknown';
  }
}

/**
 * Log an error with a reason and the affected unit.
 * @param {string} scope  subsystem, e.g. "monitor", "email", "wallet"
 * @param {string} reason short, human readable cause
 * @param {object} meta   optional structured detail (never secrets)
 */
export function logError(scope, reason, meta = {}) {
  const detail = { ...meta };
  if (detail.reason) detail.reason = sanitizeReason(detail.reason);
  console.error(`[${scope}] ${reason}`, detail);
}
