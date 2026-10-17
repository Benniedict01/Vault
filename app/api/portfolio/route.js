import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth';
import { getPortfolio } from '@/lib/monitor';

export async function GET() {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await getPortfolio(id));
  } catch (e) {
    console.error('[portfolio] load failed', { reason: e?.message });
    return NextResponse.json({ error: 'Portfolio unavailable' }, { status: 500 });
  }
}
