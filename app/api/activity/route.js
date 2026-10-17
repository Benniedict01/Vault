import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { getChainAdapter } from '@/lib/chains';
import { cached } from '@/lib/cache';

const ACTIVITY_TTL_MS = 60 * 1000;

// Recent decoded on-chain activity across the user's wallets. Chain adapters
// do the fetching; results are cached briefly so dashboard polling does not
// hammer public indexers. A failing wallet is skipped — the rest still load.
export async function GET() {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const items = await cached(`activity:${id}`, ACTIVITY_TTL_MS, async () => {
      const wallets = await db.wallet.findMany({ where: { userId: id } });
      const out = [];
      for (const w of wallets) {
        const adapter = getChainAdapter(w.chain);
        if (!adapter) continue;
        try {
          out.push(...(await adapter.getTransactions(w.address, 10)));
        } catch (err) {
          console.warn('[activity] wallet feed unavailable', { chain: w.chain, message: err?.message });
        }
      }
      out.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      return out.slice(0, 30);
    });
    return NextResponse.json(items);
  } catch (e) {
    console.error('[activity] failed', { message: e?.message });
    return NextResponse.json([], { status: 200 }); // degrade to empty, never crash
  }
}
