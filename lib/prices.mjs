// USD price lookup.
//
// A single provider (CoinGecko) is used, with two layers of protection:
//   - a 30 second cache, so an open dashboard does not spend the free tier
//     request quota on every poll
//   - a 6 hour "last known good" table, so a provider outage does not turn
//     every balance into $0.00 (planned failsafe in section 6.3 of the brief)
//
// A price that could not be resolved is `null`, never 0. Callers can then tell
// "the token is worthless" apart from "we do not know the price".

import { cacheGet, cacheSet } from './cache.mjs';
import { logError } from './log.mjs';

export const PRICE_IDS = {
  ETH: 'ethereum',
  SOL: 'solana',
  BTC: 'bitcoin',
  POL: 'polygon-ecosystem-token',
  BNB: 'binancecoin',
  AVAX: 'avalanche-2',
  xDAI: 'xdai',
  MNT: 'mantle',
  CELO: 'celo',
  CRO: 'crypto-com-chain',
  GLMR: 'moonbeam',
  MOVR: 'moonriver',
  METIS: 'metis-token',
  BERA: 'berachain-bera',
  S: 'sonic-3',
  SEI: 'sei-token',
};

const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const FRESH_TTL_MS = 30 * 1000;
const STALE_TTL_MS = 6 * 60 * 60 * 1000;
const FRESH_KEY = 'prices:v1';
const STALE_KEY = 'prices:stale:v1';
const TIMEOUT_MS = 15000;

function emptyTable() {
  return Object.fromEntries(Object.keys(PRICE_IDS).map((symbol) => [symbol, null]));
}

/** Fetch the full price table from the provider. */
async function fetchPriceTable() {
  const ids = [...new Set(Object.values(PRICE_IDS))].join(',');
  const res = await fetch(`${PRICE_URL}?ids=${ids}&vs_currencies=usd`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`price provider returned ${res.status}`);
  const json = await res.json();
  const table = emptyTable();
  for (const [symbol, id] of Object.entries(PRICE_IDS)) {
    const value = json?.[id]?.usd;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) table[symbol] = value;
  }
  return table;
}

/**
 * Current prices for the requested symbols.
 * @returns {Promise<Map<string, number|null>>} symbol -> USD price, null when unknown
 */
export async function getPrices(symbols = []) {
  const wanted = [...new Set(symbols.filter(Boolean))];
  const table = await getPriceTable();
  const map = new Map();
  for (const symbol of wanted) map.set(symbol, table[symbol] ?? null);
  return map;
}

/** The cached price table, refreshed when it is older than the fresh window. */
export async function getPriceTable() {
  const fresh = cacheGet(FRESH_KEY);
  if (fresh) return fresh;
  try {
    const table = await fetchPriceTable();
    cacheSet(FRESH_KEY, table, FRESH_TTL_MS);
    cacheSet(STALE_KEY, table, STALE_TTL_MS);
    return table;
  } catch (error) {
    logError('price', 'price lookup failed', { reason: error.message });
    const stale = cacheGet(STALE_KEY);
    if (stale) return stale;
    return emptyTable();
  }
}
