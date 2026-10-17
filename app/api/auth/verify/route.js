import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens-auth';
import { sendWelcomeEmail, isEmailError } from '@/lib/email/service';
import { rateLimitResponse } from '@/lib/security/rate-limit';

// Verifies an email token. Tokens are single-use: on success the stored hash is
// cleared so the link cannot be replayed.
export async function POST(req) {
  const limited = await rateLimitResponse(req, NextResponse, 'auth:verify', { limit: 30, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '');
    if (!token) {
      return NextResponse.json({ error: 'This verification link is invalid or expired.' }, { status: 400 });
    }

    const user = await db.user.findFirst({
      where: {
        verificationTokenHash: hashToken(token),
        verificationTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return NextResponse.json({ error: 'This verification link is invalid or expired.' }, { status: 400 });
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        verificationTokenHash: null,
        verificationTokenExpiresAt: null,
      },
    });

    // Welcome email is a bonus — verification already succeeded, so a delivery
    // failure here must never turn the request into an error.
    try {
      await sendWelcomeEmail(user);
    } catch (err) {
      if (!isEmailError(err)) console.error('[auth] welcome email failed', { message: err?.message });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[auth] verify failed', { message: e?.message });
    return NextResponse.json({ error: 'Unable to verify email right now.' }, { status: 500 });
  }
}
