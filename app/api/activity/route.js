import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { BLOCKSCOUT, CHAINS } from '@/lib/validation.mjs';
import { cacheGet, cacheSet } from '@/lib/cache.mjs';
import { logError, maskAddress } from '@/lib/log.mjs';

const ACTIVITY_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 15000;

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`explorer responded ${res.status}`);
  return res.json();
}

export async function GET() {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wallets = await db.wallet.findMany({ where: { userId: id } });
  const out = [];

  for (const wallet of wallets) {
    const chain = CHAINS[wallet.chain];
    if (!chain) continue;
    if (chain.kind !== 'evm' || !BLOCKSCOUT[wallet.chain]) continue;

    const key = `activity:${wallet.chain}:${wallet.address.toLowerCase()}`;
    let items = cacheGet(key);
    if (!items) {
      try {
        const json = await getJson(`${BLOCKSCOUT[wallet.chain]}/api/v2/addresses/${wallet.address}/transactions`);
        items = (json.items || []).slice(0, 10);
        cacheSet(key, items, ACTIVITY_TTL_MS);
      } catch (error) {
        logError('activity', 'explorer lookup failed', {
          chain: chain.name,
          wallet: maskAddress(wallet.address),
          reason: error.message,
        });
        continue;
      }
    }

    for (const item of items) {
      out.push({
        chain: chain.name,
        hash: item.hash || item.transaction_hash,
        timestamp: item.timestamp,
        from: item.from?.hash,
        to: item.to?.hash,
        value: Number(item.value || 0) / 1e18,
        symbol: chain.symbol,
        type: item.transaction_types?.[0] || item.method || 'transaction',
      });
    }
  }

  out.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return NextResponse.json(out.slice(0, 30));
}
