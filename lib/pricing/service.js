// Price service.
//
//   PriceService
//     +-- PrimaryPriceProvider  (CoinGecko simple/price)
//     +-- FallbackPriceProvider (CryptoCompare pricemulti)
//     +-- TTL cache
//
// Contract: a missing price is `null`, never 0. Zero means "worthless", which
// is a real financial claim; null means "we could not price this asset", which
// the UI must render as "Price unavailable".

import { cached } from '../cache';

// Native-coin symbol -> CoinGecko coin id. Token identity for ERC-20s and
// SPL tokens uses chain + contract/mint (see tokenPrice below), not symbols —
// many different tokens share the same ticker.
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

const PRICE_TTL_MS = Math.max(5, Number(process.env.PRICE_CACHE_TTL_SECONDS || 30)) * 1000;

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`price provider ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Primary provider: CoinGecko, keyed by coin id. */
async function fetchFromCoinGecko(ids) {
  if (!ids.length) return {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
  const json = await fetchJson(url);
  const out = {};
  for (const id of ids) {
    const v = json?.[id]?.usd;
    out[id] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

/**
 * Fallback provider: CryptoCompare, keyed by symbol. Only consulted for assets
 * the primary provider could not price.
 */
async function fetchFromCryptoCompare(symbols) {
  if (!symbols.length) return {};
  try {
    const url = `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${encodeURIComponent(symbols.join(','))}&tsyms=USD`;
    const json = await fetchJson(url);
    const out = {};
    for (const s of symbols) {
      const v = json?.[s]?.USD;
      out[s] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    return out;
  } catch {
    // Fallback failing is not fatal — those assets stay null ("unavailable").
    return Object.fromEntries(symbols.map((s) => [s, null]));
  }
}

/**
 * Resolve current USD prices for native-coin symbols.
 * @param {string[]} symbols e.g. ['ETH','SOL']
 * @returns {Promise<Record<string, number|null>>} symbol -> USD price or null
 */
export async function getNativeUsdPrices(symbols) {
  const wanted = [...new Set((symbols || []).filter((s) => s && PRICE_IDS[s]))];
  const unknown = [...new Set((symbols || []).filter((s) => s && !PRICE_IDS[s]))];
  const out = Object.fromEntries(unknown.map((s) => [s, null]));
  if (!wanted.length) return out;

  return cached(`native-prices:${wanted.join(',')}`, PRICE_TTL_MS, async () => {
    const ids = wanted.map((s) => PRICE_IDS[s]);
    const byId = await fetchFromCoinGecko(ids).catch(() => Object.fromEntries(ids.map((id) => [id, null])));

    const missing = wanted.filter((s) => byId[PRICE_IDS[s]] == null);
    if (missing.length) {
      const fallback = await fetchFromCryptoCompare(missing);
      for (const s of missing) byId[PRICE_IDS[s]] = fallback[s] ?? null;
    }

    const result = {};
    for (const s of wanted) result[s] = byId[PRICE_IDS[s]] ?? null;
    return result;
  });
}

/**
 * Price supplied by a chain/indexer for a specific token (identity = chain +
 * contract/mint). Blockscout reports `exchange_rate` per token, which is a
 * real market rate when present. Absent rate -> null, never 0.
 */
export function normalizeProviderTokenPrice(raw) {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** usdValue = amount x price, or null when the price is unknown. */
export function toUsd(amount, price) {
  if (price == null) return null;
  const a = Number(amount);
  return Number.isFinite(a) ? a * price : null;
}

export const priceCacheTtlMs = PRICE_TTL_MS;
