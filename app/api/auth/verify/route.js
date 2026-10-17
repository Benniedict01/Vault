import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens-auth';

export async function POST(req) {
  try {
    const { token } = await req.json();
    const user = await db.user.findFirst({
      where: { verificationTokenHash: hashToken(String(token || '')), verificationTokenExpiresAt: { gt: new Date() } },
    });
    if (!user) {
      return NextResponse.json({ error: 'This verification link is invalid or expired.' }, { status: 400 });
    }
    await db.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verificationTokenHash: null, verificationTokenExpiresAt: null },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[auth] email verification failed', { reason: e?.message });
    return NextResponse.json({ error: 'Unable to verify this link.' }, { status: 500 });
  }
}
