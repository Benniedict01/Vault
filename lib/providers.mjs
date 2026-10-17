// Chain providers.
//
// One adapter per family (EVM, Solana, Bitcoin). Every chain carries an
// ordered list of endpoints in `lib/validation.mjs`; they are tried in order
// so a single failing provider only skips that wallet for that run.

import { logError, safeEndpoint } from './log.mjs';

const RPC_TIMEOUT_MS = 10000;

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rpc responded ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || 'rpc error');
  return json.result;
}

/** Try every endpoint of a chain in order until one answers. */
export async function callWithFallbacks(endpoints, method, params, label) {
  const list = Array.isArray(endpoints) ? endpoints.filter(Boolean) : [];
  if (!list.length) throw new Error(`no rpc endpoint configured for ${label}`);
  let lastError = null;
  for (const url of list) {
    try {
      return await rpcCall(url, method, params);
    } catch (error) {
      lastError = error;
      logError('provider', 'rpc endpoint failed', {
        chain: label,
        endpoint: safeEndpoint(url),
        reason: error.message,
      });
    }
  }
  throw new Error(`all rpc endpoints failed for ${label}: ${lastError?.message || 'unknown'}`);
}

/** Current native balance of a wallet. Throws when no provider answered. */
export async function readBalance(wallet, chain) {
  if (chain.kind === 'evm') {
    const hex = await callWithFallbacks(chain.rpcs, 'eth_getBalance', [wallet.address, 'latest'], chain.name);
    return Number(BigInt(hex || '0x0')) / 1e18;
  }
  if (chain.kind === 'solana') {
    const result = await callWithFallbacks(chain.rpcs, 'getBalance', [wallet.address], chain.name);
    return (result?.value || 0) / 1e9;
  }
  if (chain.kind === 'bitcoin') {
    const apis = Array.isArray(chain.apis) ? chain.apis : [];
    let lastError = null;
    for (const api of apis) {
      try {
        const res = await fetch(`${api}/${encodeURIComponent(wallet.address)}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`bitcoin api responded ${res.status}`);
        const json = await res.json();
        const funded = Number(json?.chain_stats?.funded_txo_sum || 0);
        const spent = Number(json?.chain_stats?.spent_txo_sum || 0);
        return (funded - spent) / 1e8;
      } catch (error) {
        lastError = error;
        logError('provider', 'bitcoin endpoint failed', {
          chain: chain.name,
          endpoint: safeEndpoint(api),
          reason: error.message,
        });
      }
    }
    throw new Error(`all bitcoin endpoints failed for ${chain.name}: ${lastError?.message || 'unknown'}`);
  }
  throw new Error('unsupported chain');
}
