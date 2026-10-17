import crypto from 'crypto';

export function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Constant time comparison for secrets (cron token, api keys).
 * Returns false for different lengths without leaking the length through the
 * response time of the comparison itself.
 */
export function safeSecretEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}
