export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { monitorAll, monitorUser } from '@/lib/monitor';
import { getSessionUserId } from '@/lib/auth';

export async function POST(req) {
  const authorization = req.headers.get('authorization');
  const isCron = Boolean(process.env.CRON_SECRET) && authorization === `Bearer ${process.env.CRON_SECRET}`;
  const userId = isCron ? null : await getSessionUserId();
  if (!isCron && !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(isCron ? await monitorAll() : await monitorUser(userId));
  } catch (error) {
    // Detail stays in the server log; the caller gets a generic message.
    console.error('[monitor] run failed:', error?.message || error);
    return NextResponse.json({ error: 'Monitor failed.' }, { status: 500 });
  }
}
