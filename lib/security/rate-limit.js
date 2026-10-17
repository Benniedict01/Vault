// In-memory sliding-window rate limiter.
//
// Suitable for a single web instance (Render free tier). If the app ever runs
// multiple instances, swap the Map for a shared store (Redis, database) — the
// check() interface stays the same.

const buckets = new Map(); // key -> array of hit timestamps (ms)

function prune(list, windowMs, now) {
  let i = 0;
  while (i < list.length && now - list[i] >= windowMs) i++;
  return i > 0 ? list.slice(i) : list;
}

/**
 * Record a hit for `key` and report whether it is allowed.
 * @returns {{ ok: boolean, retryAfterSeconds: number }}
 */
export function check(key, { limit, windowMs }) {
  const now = Date.now();
  const hits = prune(buckets.get(key) || [], windowMs, now);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retryAfterMs = windowMs - (now - hits[0]);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || now - v[v.length - 1] >= windowMs) buckets.delete(k);
    }
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client IP for rate-limit keys. Behind Render's proxy the first
 * X-Forwarded-For entry is the client. Falls back to a shared bucket rather
 * than failing — being slightly too strict is safer than having no limit.
 */
export function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Standard limiter for an API route. Returns null when allowed, or a ready
 * NextResponse when the caller should back off.
 */
export async function rateLimitResponse(req, NextResponse, name, options) {
  const { limit, windowMs } = options;
  const key = `${name}:${clientIp(req)}`;
  const { ok, retryAfterSeconds } = check(key, { limit, windowMs });
  if (ok) return null;
  return NextResponse.json(
    { error: 'Too many requests. Please wait a moment and try again.', retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}
