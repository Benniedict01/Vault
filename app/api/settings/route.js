import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/auth';

const FIELDS = {
  email: true,
  emailVerifiedAt: true,
  tokenMonitoringEnabled: true,
  notifyDeposits: true,
  notifyWithdrawals: true,
  notifyTokenDeposits: true,
  minimumNotificationUsd: true,
};

const TOGGLES = ['tokenMonitoringEnabled', 'notifyDeposits', 'notifyWithdrawals', 'notifyTokenDeposits'];

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: userId }, select: FIELDS });
  return NextResponse.json(user);
}

export async function PATCH(req) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const data = {};
    for (const key of TOGGLES) {
      if (typeof body[key] === 'boolean') data[key] = body[key];
    }
    if (body.minimumNotificationUsd !== undefined) {
      const minimum = Number(body.minimumNotificationUsd);
      // Reject NaN/Infinity and absurd values: an unusable threshold silently
      // changes which alerts a user receives.
      if (Number.isFinite(minimum) && minimum >= 0 && minimum <= 1e9) {
        data.minimumNotificationUsd = String(minimum);
      }
    }

    const user = await db.user.update({ where: { id: userId }, data, select: FIELDS });
    return NextResponse.json(user);
  } catch (error) {
    console.error('[settings] update failed:', error?.code || error?.message);
    return NextResponse.json({ error: 'Unable to save settings.' }, { status: 500 });
  }
}
