// EVM chain adapter (Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain,
// Avalanche, and the rest of the registered EVM networks).
//
// One adapter serves every EVM chain — new EVM networks are added by
// registering metadata in lib/validation.js, not with a new implementation.

import { CHAINS, BLOCKSCOUT } from '../validation';
import { normalizeProviderTokenPrice } from '../pricing/service';
import { cached } from '../cache';

const TOKEN_TTL_MS = 60_000;

async function rpcCall(rpcUrl, method, params, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
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

async function getJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`Indexer ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** hex quantity -> decimal number of whole coins (18 decimals). */
function fromWei(hex) {
  try {
    // BigInt math first so large balances are not truncated by float precision.
    const wei = BigInt(hex);
    const whole = Number(wei / 10n ** 18n);
    const fraction = Number(wei % 10n ** 18n) / 1e18;
    return whole + fraction;
  } catch {
    return Number(hex) / 1e18;
  }
}

export function createEvmAdapter(chainId) {
  const meta = CHAINS[chainId];
  const explorer = BLOCKSCOUT[chainId] || null;

  return {
    chainId,
    name: meta?.name || chainId,
    nativeSymbol: meta?.symbol || 'ETH',
    kind: 'evm',

    validateAddress(address) {
      return /^0x[a-fA-F0-9]{40}$/.test(address) ? null : 'Invalid EVM address';
    },

    async getNativeBalance(address) {
      const hex = await rpcCall(meta.rpc, 'eth_getBalance', [address, 'latest']);
      return fromWei(hex);
    },

    async getTokenBalances(address) {
      if (!explorer) return [];
      return cached(`evm-tokens:${chainId}:${address}`, TOKEN_TTL_MS, async () => {
        try {
          const json = await getJson(`${explorer}/api/v2/addresses/${address}/tokens?type=ERC-20`);
          const items = json?.items || [];
          return items
            .map((x) => {
              const t = x.token || x;
              const decimals = Number(t.decimals ?? 18);
              const raw = x.value ?? x.balance ?? x.total?.value ?? '0';
              const amount = Number(raw) / 10 ** decimals;
              return {
                chain: chainId,
                tokenAddress: t.address || t.hash || '',
                name: t.name || 'Unknown token',
                symbol: t.symbol || 'TOKEN',
                decimals,
                amount,
                // Market rate supplied by the indexer; null when absent.
                price: normalizeProviderTokenPrice(t.exchange_rate || x.exchange_rate),
                logo: t.icon_url || null,
              };
            })
            .filter((x) => x.amount !== 0);
        } catch {
          // Token discovery is best-effort; native balances still work.
          return [];
        }
      });
    },

    async detectIncomingTransfers(address, sinceMs) {
      if (!explorer) return [];
      try {
        const json = await getJson(`${explorer}/api/v2/addresses/${address}/token-transfers?type=ERC-20`);
        return (json?.items || [])
          .slice(0, 25)
          .map((x) => {
            const t = x.token || {};
            const decimals = Number(t.decimals ?? 18);
            const raw = x.total?.value ?? x.value ?? '0';
            const amount = Number(raw) / 10 ** decimals;
            return {
              txHash: x.transaction_hash || null,
              timestamp: x.timestamp || null,
              from: x.from?.hash || x.from?.address_hash || null,
              to: x.to?.hash || x.to?.address_hash || null,
              symbol: t.symbol || 'TOKEN',
              name: t.name || 'Unknown token',
              tokenAddress: t.address || t.hash || '',
              amount,
              price: normalizeProviderTokenPrice(t.exchange_rate),
            };
          })
          .filter((t) => {
            if (!t.to || t.to.toLowerCase() !== address.toLowerCase()) return false;
            if (sinceMs && t.timestamp && new Date(t.timestamp).getTime() <= sinceMs) return false;
            return true;
          });
      } catch {
        return [];
      }
    },

    async getTransactions(address, limit = 10) {
      if (!explorer) return [];
      const json = await getJson(`${explorer}/api/v2/addresses/${address}/transactions`);
      return (json?.items || []).slice(0, limit).map((x) => ({
        chain: chainId,
        hash: x.hash || x.transaction_hash || null,
        timestamp: x.timestamp || null,
        from: x.from?.hash || null,
        to: x.to?.hash || null,
        value: fromWei(x.value || '0x0'),
        symbol: meta.symbol,
        type: x.transaction_types?.[0] || x.method || 'transaction',
      }));
    },
  };
}
