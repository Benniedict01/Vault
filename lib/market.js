// Market data layer: native + token pricing, token discovery, caching, and failsafes.
//
// Sources (all keyless by default; optional keys upgrade coverage):
//   Prices   DexScreener (DEX pools, best for memecoins) -> DefiLlama -> CoinGecko (natives)
//   Tokens   Blockscout (EVM) | Solana RPC (SPL + Token-2022) | Moralis (optional, many EVM chains + spam flags)
// Rules:
//   * A failing provider never becomes "no tokens" or "$0": we serve the last good value and report a warning.
//   * Thin-liquidity and spam tokens are shown but NOT counted in the portfolio total.
//   * Symbol-based pegging is never used (fake "USDT" tokens exist). Only canonical contract addresses are pegged.
import { BLOCKSCOUT, CHAINS } from './validation';

const MIN_LIQUIDITY_USD = Number(process.env.MIN_TOKEN_LIQUIDITY_USD || 1000);
const TTL = { native: 30_000, tokenPrice: 15_000, discovery: 60_000 };
const TIMEOUT_MS = 8_000;
const MAX_CACHE_ENTRIES = 600;

export const PRICE_IDS = {
  ETH: 'ethereum', SOL: 'solana', BTC: 'bitcoin', POL: 'polygon-ecosystem-token', BNB: 'binancecoin',
  AVAX: 'avalanche-2', xDAI: 'xdai', MNT: 'mantle', CELO: 'celo', CRO: 'crypto-com-chain',
  GLMR: 'moonbeam', MOVR: 'moonriver', METIS: 'metis-token', BERA: 'berachain-bera', S: 'sonic-3', SEI: 'sei-token',
};

// ---------- infrastructure: cache with in-flight de-duplication and stale-on-error ----------
const store = new Map();
const inflight = new Map();
export function clearMarketCache() { store.clear(); inflight.clear(); }

function remember(key, value) {
  store.set(key, { at: Date.now(), value });
  if (store.size > MAX_CACHE_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) store.delete(k);
  }
}

async function cached(key, ttl, fn, { force = false } = {}) {
  const hit = store.get(key);
  if (hit && !force && Date.now() - hit.at < ttl) return { value: hit.value, stale: false, at: hit.at };
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      const value = await fn();
      remember(key, value);
      return { value, stale: false, at: Date.now() };
    } catch (error) {
      if (hit) return { value: hit.value, stale: true, at: hit.at, error };
      throw error;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

async function fetchJson(url, { method = 'GET', headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, body, cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json', ...headers } });
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
    return await res.json();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const isEvm = (chain) => CHAINS[chain]?.kind === 'evm';
export const tokenKey = (chain, address) => `${chain}:${isEvm(chain) ? String(address).toLowerCase() : address}`;
const clean = (s, max = 32) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
const addWarning = (list, source, message) => { if (!list.some((w) => w.source === source && w.message === message)) list.push({ source, message }); };

// ---------- canonical stablecoin contracts (peg fallback only, never symbol-based) ----------
const PEGGED = new Set([
  'ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7', 'ethereum:0x6b175474e89094c44da98b954eedeac495271d0f',
  'base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  'arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831', 'arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  'optimism:0x0b2c639c533813f4aa9d7837caf62653d097ff85', 'optimism:0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
  'polygon:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 'polygon:0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  'bsc:0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 'bsc:0x55d398326f99059ff775485246999027b3197955',
  'avalanche:0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', 'avalanche:0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
  'solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'solana:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

// ---------- native coin prices ----------
async function fetchNative(ids) {
  const out = {};
  try {
    const j = await fetchJson(`https://coins.llama.fi/prices/current/${ids.map((i) => `coingecko:${i}`).join(',')}`);
    for (const id of ids) {
      const c = j?.coins?.[`coingecko:${id}`];
      if (c && Number.isFinite(Number(c.price)) && Number(c.price) > 0) out[id] = Number(c.price);
    }
  } catch { /* fall through to CoinGecko */ }
  const missing = ids.filter((i) => !(i in out));
  if (missing.length) {
    try {
      const headers = process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : {};
      const j = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${missing.join(',')}&vs_currencies=usd`, { headers });
      for (const id of missing) { const p = Number(j?.[id]?.usd); if (p > 0) out[id] = p; }
    } catch (e) { if (!Object.keys(out).length) throw e; }
  }
  if (!Object.keys(out).length) throw new Error('no prices returned');
  return out;
}

// Returns { prices: { SYMBOL: { usd, stale } }, warnings }. Missing symbols are simply absent (never $0).
export async function getNativePrices(symbols, { force = false } = {}) {
  const warnings = [];
  const prices = {};
  const ids = [...new Set(symbols.map((s) => PRICE_IDS[s]).filter(Boolean))].sort();
  if (!ids.length) return { prices, warnings };
  try {
    const r = await cached(`native:${ids.join(',')}`, TTL.native, () => fetchNative(ids), { force });
    for (const [symbol, id] of Object.entries(PRICE_IDS)) if (r.value[id] > 0) prices[symbol] = { usd: r.value[id], stale: r.stale };
    if (r.stale) addWarning(warnings, 'prices', 'Coin price feeds are unreachable. Showing last known prices.');
  } catch (e) {
    addWarning(warnings, 'prices', `Coin price feeds are unreachable (${e.message}). Values may be missing.`);
  }
  return { prices, warnings };
}

// ---------- token prices: DexScreener -> DefiLlama ----------
const DEX_CHAIN = {
  ethereum: 'ethereum', base: 'base', arbitrum: 'arbitrum', optimism: 'optimism', polygon: 'polygon', bsc: 'bsc', avalanche: 'avalanche',
  solana: 'solana', gnosis: 'gnosis', linea: 'linea', scroll: 'scroll', zksync: 'zksync', mantle: 'mantle', celo: 'celo', cronos: 'cronos',
  moonbeam: 'moonbeam', moonriver: 'moonriver', metis: 'metis', blast: 'blast', mode: 'mode', taiko: 'taiko', sonic: 'sonic',
  berachain: 'berachain', ink: 'ink', opbnb: 'opbnb',
};
const LLAMA_CHAIN = {
  ethereum: 'ethereum', base: 'base', arbitrum: 'arbitrum', optimism: 'optimism', polygon: 'polygon', bsc: 'bsc', avalanche: 'avax',
  solana: 'solana', gnosis: 'xdai', linea: 'linea', scroll: 'scroll', zksync: 'era', mantle: 'mantle', celo: 'celo', cronos: 'cronos',
  moonbeam: 'moonbeam', moonriver: 'moonriver', metis: 'metis', blast: 'blast', mode: 'mode', taiko: 'taiko', sonic: 'sonic',
  berachain: 'berachain', ink: 'ink', opbnb: 'op_bnb',
};

function parseDexPairs(pairs, chain, wanted, dexChain) {
  const norm = (a) => (isEvm(chain) ? String(a).toLowerCase() : String(a));
  const want = new Set(wanted.map(norm));
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const base = p?.baseToken?.address;
    if (!base || (p.chainId && p.chainId !== dexChain)) continue;
    const k = norm(base);
    if (!want.has(k)) continue;
    const usd = Number(p.priceUsd);
    if (!(usd > 0)) continue;
    const liquidityUsd = Number(p?.liquidity?.usd ?? 0);
    const cur = best.get(k);
    if (!cur || liquidityUsd > cur.liquidityUsd) {
      best.set(k, { usd, liquidityUsd, source: 'DexScreener', symbol: clean(p.baseToken.symbol), name: clean(p.baseToken.name, 48) });
    }
  }
  return best;
}

async function dexPrices(chain, addresses, force) {
  const dexChain = DEX_CHAIN[chain];
  const found = new Map();
  let error = null;
  if (!dexChain) return { found, error };
  for (let i = 0; i < addresses.length; i += 20) {
    const chunk = addresses.slice(i, i + 20);
    try {
      const r = await cached(`dex:${dexChain}:${chunk.join(',')}`, TTL.tokenPrice, async () => {
        const j = await fetchJson(`https://api.dexscreener.com/tokens/v1/${dexChain}/${chunk.join(',')}`);
        return Array.isArray(j) ? j : j?.pairs || [];
      }, { force });
      for (const [k, v] of parseDexPairs(r.value, chain, chunk, dexChain)) found.set(k, { ...v, stale: r.stale });
    } catch (e) {
      if (e.status === 400 || e.status === 404) continue; // unknown chain id / nothing listed: not an outage
      error = e;
    }
  }
  return { found, error };
}

async function llamaPrices(items, force) {
  const found = new Map();
  const todo = items.filter((it) => LLAMA_CHAIN[it.chain]);
  for (let i = 0; i < todo.length; i += 40) {
    const chunk = todo.slice(i, i + 40);
    const ids = chunk.map((it) => `${LLAMA_CHAIN[it.chain]}:${it.address}`);
    try {
      const r = await cached(`llama:${ids.join(',')}`, TTL.tokenPrice, async () => (await fetchJson(`https://coins.llama.fi/prices/current/${ids.join(',')}`))?.coins || {}, { force });
      const lower = Object.fromEntries(Object.entries(r.value).map(([k, v]) => [k.toLowerCase(), v]));
      chunk.forEach((it, n) => {
        const c = lower[ids[n].toLowerCase()];
        if (c && Number(c.price) > 0 && (c.confidence === undefined || Number(c.confidence) >= 0.5)) {
          found.set(tokenKey(it.chain, it.address), { usd: Number(c.price), liquidityUsd: null, source: 'DefiLlama', symbol: clean(c.symbol), name: '', stale: r.stale });
        }
      });
    } catch { /* optional fallback source */ }
  }
  return found;
}

// items: [{chain, address}] -> { prices: Map(tokenKey -> {usd, liquidityUsd, source, symbol, name, stale}), warnings }
export async function getTokenPrices(items, { force = false } = {}) {
  const warnings = [];
  const prices = new Map();
  const unique = new Map();
  for (const it of items) if (it?.chain && it?.address) unique.set(tokenKey(it.chain, it.address), it);
  const byChain = new Map();
  for (const it of unique.values()) { if (!byChain.has(it.chain)) byChain.set(it.chain, []); byChain.get(it.chain).push(it.address); }

  await Promise.all([...byChain.entries()].map(async ([chain, addrs]) => {
    const { found, error } = await dexPrices(chain, addrs, force);
    for (const [k, v] of found) prices.set(`${chain}:${k}`.replace(`${chain}:${chain}:`, `${chain}:`), v);
    if (error) addWarning(warnings, 'DexScreener', `DexScreener is unreachable (${error.message}). Token prices may be missing or delayed.`);
  }));

  const missing = [...unique.values()].filter((it) => !prices.has(tokenKey(it.chain, it.address)));
  if (missing.length) for (const [k, v] of await llamaPrices(missing, force)) prices.set(k, v);

  for (const v of prices.values()) if (v.stale) addWarning(warnings, 'stale', 'Some token prices are from the last successful update because a price feed is unreachable.');
  return { prices, warnings };
}

// ---------- token discovery ----------
const SOLANA_RPC = () => process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const SPL_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const MORALIS_CHAIN = { ethereum: 'eth', polygon: 'polygon', bsc: 'bsc', avalanche: 'avalanche', arbitrum: 'arbitrum', optimism: 'optimism', base: 'base', linea: 'linea', gnosis: 'gnosis', cronos: 'cronos' };

async function discoverSolana(wallet) {
  const byMint = new Map();
  for (const programId of SPL_PROGRAMS) {
    const j = await fetchJson(SOLANA_RPC(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [wallet.address, { programId }, { encoding: 'jsonParsed' }] }),
    });
    if (j.error) throw new Error(j.error.message || 'Solana RPC error');
    for (const a of j.result?.value || []) {
      const info = a?.account?.data?.parsed?.info;
      const amount = Number(info?.tokenAmount?.uiAmountString ?? info?.tokenAmount?.uiAmount ?? 0);
      if (!info?.mint || !(amount > 0)) continue;
      const cur = byMint.get(info.mint);
      if (cur) cur.amount += amount;
      else byMint.set(info.mint, { chain: 'solana', address: info.mint, name: '', symbol: `${info.mint.slice(0, 4)}…${info.mint.slice(-4)}`, decimals: info.tokenAmount.decimals, amount, hintPrice: 0, hintSource: null, spam: false, logo: null });
    }
  }
  return { tokens: [...byMint.values()] };
}

async function discoverBlockscout(wallet) {
  const base = BLOCKSCOUT[wallet.chain];
  const tokens = [];
  let url = `${base}/api/v2/addresses/${wallet.address}/tokens?type=ERC-20`;
  for (let page = 0; page < 3 && url; page++) {
    let j;
    try { j = await fetchJson(url); } catch (e) { if (page === 0) throw e; break; }
    for (const x of j?.items || []) {
      const t = x.token || x;
      const decimals = Number(t.decimals ?? 18);
      const amount = Number(x.value ?? x.balance ?? '0') / 10 ** decimals;
      const address = t.address_hash || t.address || t.hash || '';
      if (!address || !(amount > 0)) continue;
      tokens.push({ chain: wallet.chain, address, name: clean(t.name || 'Unknown token', 48), symbol: clean(t.symbol || 'TOKEN'), decimals, amount, hintPrice: Number(t.exchange_rate || 0), hintSource: 'Blockscout', spam: false, logo: t.icon_url || null });
    }
    const next = j?.next_page_params;
    url = next ? `${base}/api/v2/addresses/${wallet.address}/tokens?type=ERC-20&${new URLSearchParams(Object.entries(next).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)]))}` : null;
  }
  return { tokens };
}

async function discoverMoralis(wallet) {
  const tokens = [];
  let cursor = '';
  for (let page = 0; page < 3; page++) {
    const j = await fetchJson(`https://deep-index.moralis.io/api/v2.2/wallets/${wallet.address}/tokens?chain=${MORALIS_CHAIN[wallet.chain]}&exclude_native=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { 'X-API-Key': process.env.MORALIS_API_KEY } });
    for (const x of j?.result || []) {
      if (x.native_token) continue;
      const decimals = Number(x.decimals ?? 18);
      const amount = Number(x.balance_formatted ?? Number(x.balance) / 10 ** decimals);
      if (!x.token_address || !(amount > 0)) continue;
      tokens.push({ chain: wallet.chain, address: x.token_address, name: clean(x.name || 'Unknown token', 48), symbol: clean(x.symbol || 'TOKEN'), decimals, amount, hintPrice: Number(x.usd_price || 0), hintSource: 'Moralis', spam: !!x.possible_spam, logo: x.logo || null });
    }
    cursor = j?.cursor || '';
    if (!cursor) break;
  }
  return { tokens };
}

async function discoverTokens(wallet) {
  const c = CHAINS[wallet.chain];
  if (c.kind === 'solana') return discoverSolana(wallet);
  if (process.env.MORALIS_API_KEY && MORALIS_CHAIN[wallet.chain]) {
    try { return await discoverMoralis(wallet); }
    catch (e) { if (!BLOCKSCOUT[wallet.chain]) throw e; }
  }
  if (BLOCKSCOUT[wallet.chain]) return discoverBlockscout(wallet);
  return { tokens: [], unsupported: true };
}

// ---------- portfolio assembly ----------
export async function getTokenHoldings(wallets, { force = false } = {}) {
  const warnings = [];
  const raw = [];
  await Promise.all(wallets.map(async (wallet) => {
    const c = CHAINS[wallet.chain];
    if (!c || (c.kind !== 'evm' && c.kind !== 'solana')) return;
    try {
      const r = await cached(`disc:${tokenKey(wallet.chain, wallet.address)}`, TTL.discovery, () => discoverTokens(wallet), { force });
      if (r.value.unsupported) {
        addWarning(warnings, `no-indexer-${wallet.chain}`, `Token discovery is not available for ${c.name}. Add a MORALIS_API_KEY to enable it.`);
        return;
      }
      if (r.stale) addWarning(warnings, `stale-${wallet.chain}`, `Could not refresh tokens for ${wallet.label} (${c.name}). Showing the last known list.`);
      for (const t of r.value.tokens) raw.push({ ...t, wallet });
    } catch (e) {
      addWarning(warnings, `tokens-${wallet.id}`, `Could not read tokens for ${wallet.label} (${c.name}): ${e.message}`);
    }
  }));

  const { prices, warnings: pw } = await getTokenPrices(raw.map((t) => ({ chain: t.chain, address: t.address })), { force });
  warnings.push(...pw);

  const tokens = raw.map((t) => {
    const key = tokenKey(t.chain, t.address);
    const stable = PEGGED.has(key);
    let market = prices.get(key);
    // A stablecoin price is only trusted from a deep market. A dust pool quoting canonical USDC at $0.50 is noise,
    // while a real depeg (deep liquidity, lower price) is still shown.
    if (stable && market && market.liquidityUsd !== null && market.liquidityUsd < MIN_LIQUIDITY_USD) market = undefined;
    let price = market?.usd || 0;
    let source = market?.source || null;
    const liquidityUsd = market?.liquidityUsd ?? null;
    let symbol = t.symbol;
    let name = t.name;
    if (market?.symbol && (t.chain === 'solana' || !symbol || symbol === 'TOKEN')) { symbol = market.symbol; name = market.name || name; }
    if (!price && t.hintPrice > 0) { price = t.hintPrice; source = t.hintSource; }
    if (!price && stable) { price = 1; source = 'peg'; }
    let status = 'live';
    if (t.spam) status = 'spam';
    else if (!price) status = 'unpriced';
    else if (source === 'peg') status = 'peg';
    else if (!stable && liquidityUsd !== null && liquidityUsd < MIN_LIQUIDITY_USD) status = 'low-liquidity';
    return {
      walletId: t.wallet.id, walletLabel: t.wallet.label, chain: t.chain, chainName: CHAINS[t.chain].name,
      address: t.address, symbol: symbol || 'TOKEN', name: name || 'Unknown token', decimals: t.decimals, amount: t.amount, logo: t.logo,
      price, usdValue: price * t.amount, liquidityUsd, priceSource: source, stale: !!market?.stale, status, kind: stable ? 'stable' : 'token',
      counted: status === 'live' || status === 'peg',
    };
  });
  tokens.sort((a, b) => Number(b.counted) - Number(a.counted) || b.usdValue - a.usdValue);

  const sum = (f) => tokens.filter(f).reduce((s, t) => s + t.usdValue, 0);
  return {
    tokens, warnings,
    summary: {
      stableUsd: sum((t) => t.counted && t.kind === 'stable'),
      tokenUsd: sum((t) => t.counted && t.kind !== 'stable'),
      excludedUsd: sum((t) => !t.counted),
      excludedCount: tokens.filter((t) => !t.counted).length,
    },
  };
}
