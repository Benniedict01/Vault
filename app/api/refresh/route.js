export const dynamic = 'force-dynamic';
export const maxDuration = 60;
import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { monitorUser, getPortfolio } from '@/lib/monitor';

// "Refresh now": a live chain read for this user's wallets (alerts still fire), then a price/token
// refresh that bypasses the short-lived caches. A per-user cooldown stops button-mashing from
// burning free API quotas.
const lastRun = new Map();
const COOLDOWN_MS = 5000;

export async function POST() {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const now = Date.now();
  const recent = now - (lastRun.get(id) || 0) < COOLDOWN_MS;
  try {
    let monitor = { checked: 0, alerts: 0, failures: [] };
    if (!recent) { lastRun.set(id, now); monitor = await monitorUser(id); }
    const portfolio = await getPortfolio(id, { force: !recent });
    return NextResponse.json({ ok: true, cooldown: recent, monitor, portfolio });
  } catch (e) {
    console.error('[refresh]', e.message);
    return NextResponse.json({ error: 'Refresh failed. Please try again in a moment.' }, { status: 500 });
  }
}
