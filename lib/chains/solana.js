// Solana chain adapter.

import { normalizeProviderTokenPrice } from '../pricing/service';
import { cached } from '../cache';

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_TTL_MS = 60_000;

async function rpcCall(method, params, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'RPC error');
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export const solanaAdapter = Object.freeze({
  chainId: 'solana',
  name: 'Solana',
  nativeSymbol: 'SOL',
  kind: 'solana',

  validateAddress(address) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? null : 'Invalid Solana address';
  },

  async getNativeBalance(address) {
    const result = await rpcCall('getBalance', [address]);
    return (result?.value || 0) / 1e9;
  },

  async getTokenBalances(address) {
    return cached(`sol-tokens:${address}`, TOKEN_TTL_MS, async () => {
      try {
        const result = await rpcCall('getTokenAccountsByOwner', [
          address,
          { programId: TOKEN_PROGRAM },
          { encoding: 'jsonParsed' },
        ]);
        return (result?.value || [])
          .map((a) => {
            const info = a.account.data.parsed.info;
            const ui = info.tokenAmount.uiAmount || 0;
            return {
              chain: 'solana',
              tokenAddress: info.mint,
              name: info.mint,
              symbol: info.mint.slice(0, 6),
              decimals: info.tokenAmount.decimals,
              amount: ui,
              // The public SPL-token endpoint reports no market rate; the
              // portfolio must show "Price unavailable", not $0.00.
              price: null,
              logo: null,
            };
          })
          .filter((x) => x.amount > 0);
      } catch {
        return [];
      }
    });
  },

  async detectIncomingTransfers() {
    // SPL transfer detection needs an indexer (e.g. Helius / Solscan API).
    // Left as a future adapter extension; native balance diffs still detect
    // SOL deposits in the monitor.
    return [];
  },

  async getTransactions() {
    return [];
  },
});
