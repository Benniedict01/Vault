import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { randomToken, hashToken } from '@/lib/tokens-auth';
import { sendVerificationEmail, wasRecentlySent, userMessage, isEmailError } from '@/lib/email/service';
import { rateLimitResponse, check } from '@/lib/security/rate-limit';

const RESEND_COOLDOWN_MS = 60 * 1000;

// Re-sends the verification email. Responses are generic (no account
// enumeration) and sends are throttled per IP and per account.
export async function POST(req) {
  const ipLimited = await rateLimitResponse(req, NextResponse, 'auth:resend-verification', { limit: 10, windowMs: 60 * 60 * 1000 });
  if (ipLimited) return ipLimited;

  try {
    const body = await req.json().catch(() => ({}));
    const normalized = String(body.email || '').trim().toLowerCase();
    const generic = {
      ok: true,
      message: 'If the account exists and needs verification, a new verification email has been sent.',
    };

    const user = await db.user.findUnique({ where: { email: normalized } });
    if (!user || user.emailVerifiedAt) return NextResponse.json(generic);

    const emailGate = check(`auth:resend-verification:email:${normalized}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (!emailGate.ok) return NextResponse.json(generic);

    // Per-account cooldown: one verification email per minute at most.
    if (await wasRecentlySent(user.id, 'verification', RESEND_COOLDOWN_MS)) {
      return NextResponse.json(generic);
    }

    const token = randomToken();
    await db.user.update({
      where: { id: user.id },
      data: {
        verificationTokenHash: hashToken(token),
        verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    try {
      await sendVerificationEmail(user, token);
    } catch (err) {
      // Still generic on the way out — but log the real cause for operators.
      console.error('[auth] verification resend failed', {
        code: isEmailError(err) ? err.code : 'UNKNOWN',
        message: err?.message,
      });
      return NextResponse.json(
        { error: isEmailError(err) ? userMessage(err) : 'Email delivery is not configured or the message could not be sent.' },
        { status: 503 }
      );
    }

    return NextResponse.json(generic);
  } catch (e) {
    console.error('[auth] resend-verification failed', { message: e?.message });
    return NextResponse.json({ error: 'Unable to process that request right now.' }, { status: 500 });
  }
}
