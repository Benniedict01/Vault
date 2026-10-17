export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { monitorAll, monitorUser } from '@/lib/monitor';
import { getSessionUserId } from '@/lib/auth';
import { safeSecretEqual } from '@/lib/tokens-auth';

export async function POST(req) {
  const header = req.headers.get('authorization') || '';
  const secret = process.env.CRON_SECRET || '';
  const cron = Boolean(secret) && safeSecretEqual(header, `Bearer ${secret}`);

  const uid = await getSessionUserId();
  if (!cron && !uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = cron ? await monitorAll() : await monitorUser(uid);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[monitor] run failed', { reason: e?.message });
    return NextResponse.json({ error: 'Monitor failed.' }, { status: 500 });
  }
}
