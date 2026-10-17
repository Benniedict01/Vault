export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { monitorAll, monitorUser } from '@/lib/monitor';
import { getSessionUserId } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/security/rate-limit';

// Constant-time secret comparison so the cron endpoint cannot be probed via
// timing differences.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Monitoring trigger. The scheduled job (GitHub Actions cron -> Render Cron ->
// any external scheduler) calls this with `Authorization: Bearer CRON_SECRET`
// to run every user's wallets. Signed-in users can trigger their own run.
export async function POST(req) {
  const auth = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret) && auth.startsWith('Bearer ') && safeEqual(auth.slice(7), cronSecret);

  const uid = await getSessionUserId();
  if (!isCron && !uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isCron) {
    const limited = await rateLimitResponse(req, NextResponse, `monitor:${uid}`, { limit: 30, windowMs: 60 * 1000 });
    if (limited) return limited;
  }

  try {
    const result = isCron ? await monitorAll() : await monitorUser(uid);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[monitor] run failed', { message: e?.message });
    return NextResponse.json({ error: 'Monitor run failed.' }, { status: 500 });
  }
}
