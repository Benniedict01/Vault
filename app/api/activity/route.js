import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { BLOCKSCOUT, CHAINS, maskAddress } from '@/lib/validation';

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`explorer HTTP ${res.status}`);
  return res.json();
}

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wallets = await db.wallet.findMany({ where: { userId } });
  const items = [];

  for (const wallet of wallets) {
    const chain = CHAINS[wallet.chain];
    // A wallet on a network removed from the registry must not break this list.
    if (!chain) continue;
    if (chain.kind !== 'evm' || !BLOCKSCOUT[wallet.chain]) continue;

    try {
      const json = await getJson(`${BLOCKSCOUT[wallet.chain]}/api/v2/addresses/${wallet.address}/transactions`);
      for (const tx of (json.items || []).slice(0, 10)) {
        items.push({
          chain: chain.name,
          hash: tx.hash || tx.transaction_hash,
          timestamp: tx.timestamp,
          from: tx.from?.hash,
          to: tx.to?.hash,
          value: Number(tx.value || 0) / 1e18,
          symbol: chain.symbol,
          type: tx.transaction_types?.[0] || tx.method || 'transaction',
        });
      }
    } catch (error) {
      // One failing explorer must not stop the other wallets.
      console.warn(`[activity] ${wallet.chain}/${maskAddress(wallet.address)}:`, error?.message);
    }
  }

  items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return NextResponse.json(items.slice(0, 30));
}
