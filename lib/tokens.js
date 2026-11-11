// Incoming/outgoing ERC-20 transfer feed. Cursor ownership belongs to lib/monitor.js:
// this function throws on indexer errors so the caller never advances a failed cursor.
import { BLOCKSCOUT } from './validation';

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Indexer HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

export async function getEvmTokenTransfers(wallet, since = null) {
  const base = BLOCKSCOUT[wallet.chain];
  if (!base) return [];
  const endpoint = `${base}/api/v2/addresses/${wallet.address}/token-transfers`;
  const all = [];
  let pageParams = null;
  let page = 0;
  let reachedCursor = false;
  do {
    const url = new URL(endpoint);
    url.searchParams.set('type', 'ERC-20');
    if (pageParams) for (const [key, value] of Object.entries(pageParams)) url.searchParams.set(key, String(value));
    const data = await getJson(url.toString());
    const items = data?.items || [];
    for (const item of items) {
      const timestamp = new Date(item.timestamp).getTime();
      if (since && Number.isFinite(timestamp) && timestamp < since.getTime()) reachedCursor = true;
      const token = item.token || {};
      const decimals = Number(token.decimals ?? 18);
      const raw = item.total?.value ?? item.value ?? '0';
      const amount = Number(raw) / 10 ** decimals;
      const txHash = item.transaction_hash || '';
      const logIndex = item.log_index ?? item.logIndex ?? '';
      all.push({
        txHash, timestamp: item.timestamp,
        eventKey: `token:${wallet.chain}:${txHash}:${logIndex || `${token.address_hash || ''}:${item.from?.hash || ''}:${item.to?.hash || ''}:${raw}`}`,
        from: item.from?.hash || item.from?.address_hash,
        to: item.to?.hash || item.to?.address_hash,
        tokenAddress: token.address_hash || token.address || '',
        symbol: token.symbol || 'TOKEN', name: token.name || 'Unknown token', amount,
        usdValue: amount * Number(token.exchange_rate || 0),
        explorerUrl: txHash ? `${base}/tx/${txHash}` : '',
      });
    }
    pageParams = data?.next_page_params || null;
    page++;
    // A bounded page budget protects monitoring runtime. Throwing preserves the old cursor;
    // the next run retries rather than silently skipping an incomplete indexer response.
    if (page >= 20 && pageParams && !reachedCursor) throw new Error('Token transfer backlog exceeds the 20-page safety limit; cursor was not advanced.');
  } while (pageParams && !reachedCursor);
  return all;
}
