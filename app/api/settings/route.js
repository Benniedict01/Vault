import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/auth';

const SETTINGS_SELECT = {
  email: true,
  emailVerifiedAt: true,
  tokenMonitoringEnabled: true,
  notifyDeposits: true,
  notifyWithdrawals: true,
  notifyTokenDeposits: true,
  minimumNotificationUsd: true,
};

const BOOLEAN_FIELDS = ['tokenMonitoringEnabled', 'notifyDeposits', 'notifyWithdrawals', 'notifyTokenDeposits'];

export async function GET() {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const settings = await db.user.findUnique({ where: { id }, select: SETTINGS_SELECT });
  return NextResponse.json(settings);
}

export async function PATCH(req) {
  const id = await getSessionUserId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const data = {};
    for (const field of BOOLEAN_FIELDS) {
      if (typeof body?.[field] === 'boolean') data[field] = body[field];
    }
    if (body?.minimumNotificationUsd !== undefined) {
      const value = Number(body.minimumNotificationUsd);
      if (!Number.isFinite(value) || value < 0 || value > 1000000) {
        return NextResponse.json({ error: 'Minimum notification must be a number between 0 and 1000000.' }, { status: 400 });
      }
      data.minimumNotificationUsd = String(value);
    }
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }
    const settings = await db.user.update({ where: { id }, data, select: SETTINGS_SELECT });
    return NextResponse.json(settings);
  } catch (e) {
    console.error('[settings] update failed', { reason: e?.message });
    return NextResponse.json({ error: 'Unable to save settings.' }, { status: 500 });
  }
}
