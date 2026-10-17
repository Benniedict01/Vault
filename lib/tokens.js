// Token balances and token transfers.
//
// Data comes from public explorers (Blockscout v2) and the Solana RPC. The
// results are cached for a short window so that an open dashboard, which polls
// every few seconds, does not spend the free tier quota of the explorers
// (section 6.2 of the engineering brief: "cap per wallet token scans").
//
// A failing explorer never throws into the caller: it returns an empty list
// and logs the reason, so one broken provider cannot stop a monitoring run.

import { BLOCKSCOUT } from './validation.mjs';
import { cacheGet, cacheSet } from './cache.mjs';
import { logError, maskAddress } from './log.mjs';

const TOKEN_TTL_MS = 30 * 1000;
const TRANSFER_TTL_MS = 20 * 1000;
const TIMEOUT_MS = 15000;

async function getJson(url) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`indexer responded ${res.status}`);
  return res.json();
}

function tokenAmount(raw, decimals) {
  const value = Number(raw || 0);
  if (!Number.isFinite(value)) return 0;
  return value / 10 ** decimals;
}

/** ERC-20 balances for a wallet, as reported by the chain explorer. */
export async function getEvmTokens(wallet) {
  const base = BLOCKSCOUT[wallet.chain];
  if (!base) return [];
  const key = `tokens:${wallet.chain}:${wallet.address.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const json = await getJson(`${base}/api/v2/addresses/${wallet.address}/tokens?type=ERC-20`);
    const items = json?.items || [];
    const result = items
      .map((entry) => {
        const token = entry.token || entry;
        const decimals = Number(token.decimals || 18);
        const amount = tokenAmount(entry.value ?? entry.balance ?? entry.total?.value, decimals);
        const price = Number(token.exchange_rate || entry.exchange_rate || 0);
        return {
          chain: wallet.chain,
          address: token.address || token.hash || '',
          name: token.name || 'Unknown token',
          symbol: token.symbol || 'TOKEN',
          decimals,
          amount,
          usdValue: amount * price,
          price,
          logo: token.icon_url || null,
        };
      })
      .filter((token) => token.amount !== 0);
    cacheSet(key, result, TOKEN_TTL_MS);
    return result;
  } catch (error) {
    logError('tokens', 'token balance lookup failed', {
      chain: wallet.chain,
      wallet: maskAddress(wallet.address),
      reason: error.message,
    });
    return [];
  }
}

/** Recent ERC-20 transfers for a wallet, newest first. */
export async function getEvmTokenTransfers(wallet) {
  const base = BLOCKSCOUT[wallet.chain];
  if (!base) return [];
  const key = `transfers:${wallet.chain}:${wallet.address.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const json = await getJson(`${base}/api/v2/addresses/${wallet.address}/token-transfers?type=ERC-20`);
    const result = (json?.items || []).slice(0, 25).map((entry) => {
      const token = entry.token || {};
      const decimals = Number(token.decimals || 18);
      const amount = tokenAmount(entry.total?.value ?? entry.value, decimals);
      return {
        txHash: entry.transaction_hash,
        timestamp: entry.timestamp,
        from: entry.from?.hash || entry.from?.address_hash,
        to: entry.to?.hash || entry.to?.address_hash,
        symbol: token.symbol || 'TOKEN',
        name: token.name || 'Unknown token',
        amount,
        usdValue: amount * Number(token.exchange_rate || 0),
      };
    });
    cacheSet(key, result, TRANSFER_TTL_MS);
    return result;
  } catch (error) {
    logError('tokens', 'token transfer lookup failed', {
      chain: wallet.chain,
      wallet: maskAddress(wallet.address),
      reason: error.message,
    });
    return [];
  }
}

/** SPL token balances for a Solana address. */
export async function getSolanaTokens(address, rpcUrl = 'https://api.mainnet-beta.solana.com') {
  const key = `tokens:solana:${address}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }],
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`solana rpc responded ${res.status}`);
    const json = await res.json();
    if (json?.error) throw new Error(json.error.message || 'solana rpc error');
    const result = (json.result?.value || [])
      .map((entry) => {
        const info = entry.account.data.parsed.info;
        return {
          chain: 'solana',
          address: info.mint,
          name: info.mint,
          symbol: info.mint.slice(0, 6),
          decimals: info.tokenAmount.decimals,
          amount: info.tokenAmount.uiAmount || 0,
          usdValue: 0,
          price: 0,
          logo: null,
        };
      })
      .filter((token) => token.amount > 0);
    cacheSet(key, result, TOKEN_TTL_MS);
    return result;
  } catch (error) {
    logError('tokens', 'solana token lookup failed', {
      wallet: maskAddress(address),
      reason: error.message,
    });
    return [];
  }
}
