// Tiny in-process TTL cache.
//
// Purpose: protect free-tier provider quotas (CoinGecko, Blockscout, public
// RPCs) and keep the dashboard responsive without hammering public endpoints.
// Deliberately simple: a Map of key -> { value, expiresAt } with lazy
// eviction. It lives in the memory of a single instance, so a cold start
// simply starts with an empty cache - that is the expected behaviour.

const store = new Map();

/** Read a cached value, or undefined when it is missing or expired. */
export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

/** Store a value for `ttlMs` milliseconds. */
export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/**
 * Return the cached value for `key`, or produce a fresh one with `producer`
 * and cache it. Producer failures are not cached, so the next call retries.
 */
export async function remember(key, ttlMs, producer) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await producer();
  if (value !== undefined) cacheSet(key, value, ttlMs);
  return value;
}

/** Remove everything from the cache (used by tests). */
export function cacheClear() {
  store.clear();
}
