// Tiny in-memory TTL cache.
//
// Render's free tier runs a single web instance, so an in-process cache is the
// simplest reliable option. The interface is deliberately small so a Redis or
// managed-cache implementation can replace it later without touching callers.

const store = new Map();

/**
 * Return a cached value for `key`, or run `fn` and cache its result for
 * `ttlMs`. Concurrent callers for the same key share one in-flight promise so
 * a burst of dashboard polls triggers a single upstream request.
 */
export async function cached(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit) {
    if (hit.expiresAt > now) return hit.value;
    if (hit.inflight) return hit.inflight;
  }

  const inflight = Promise.resolve()
    .then(fn)
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs, inflight: null });
      return value;
    })
    .catch((err) => {
      // Never cache failures — the next caller should be free to retry.
      const current = store.get(key);
      if (current && current.inflight === inflight) store.delete(key);
      throw err;
    });

  store.set(key, { value: undefined, expiresAt: now + ttlMs, inflight });
  return inflight;
}
