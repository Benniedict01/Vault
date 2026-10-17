// Bitcoin chain adapter (Esplora/Blockstream public API).

async function getJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`Bitcoin API ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const bitcoinAdapter = Object.freeze({
  chainId: 'bitcoin',
  name: 'Bitcoin',
  nativeSymbol: 'BTC',
  kind: 'bitcoin',

  validateAddress(address) {
    return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/.test(address) ? null : 'Invalid Bitcoin address';
  },

  async getNativeBalance(address) {
    const json = await getJson(`https://blockstream.info/api/address/${encodeURIComponent(address)}`);
    return ((json.chain_stats?.funded_txo_sum || 0) - (json.chain_stats?.spent_txo_sum || 0)) / 1e8;
  },

  async getTokenBalances() {
    return [];
  },

  async detectIncomingTransfers() {
    return [];
  },

  async getTransactions() {
    return [];
  },
});
