import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { getPortfolio } from '@/lib/portfolio';

// Authoritative portfolio calculation lives in lib/portfolio.js (server-side):
// per-wallet, per-asset and total USD values with explicit price-availability
// flags. Never computed from frontend state.
export async function GET() {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await getPortfolio(id));
  } catch (e) {
    console.error('[portfolio] failed', { message: e?.message });
    return NextResponse.json(
      { error: 'Portfolio data is temporarily unavailable. Please try again.' },
      { status: 503 }
    );
  }
}
