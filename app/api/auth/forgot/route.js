import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { randomToken, hashToken } from '@/lib/tokens-auth';
import { sendPasswordResetEmail, isEmailError } from '@/lib/email/service';
import { rateLimitResponse, check } from '@/lib/security/rate-limit';

// Password reset request. The response is always the same generic message so
// the endpoint cannot be used to test whether an email address has an account.
export async function POST(req) {
  const limited = await rateLimitResponse(req, NextResponse, 'auth:forgot', { limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const generic = {
    ok: true,
    message: "If an account exists for that email, you'll receive a password reset email.",
  };

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();

    const emailGate = check(`auth:forgot:email:${email}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (!emailGate.ok) return NextResponse.json(generic);

    const user = await db.user.findUnique({ where: { email } });
    if (!user) return NextResponse.json(generic);

    // Only the token hash is stored; the raw token lives in the email link.
    const token = randomToken();
    await db.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashToken(token),
        resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    try {
      await sendPasswordResetEmail(user, token);
    } catch (err) {
      // Never reveal delivery problems per-address (enumeration vector) —
      // operators get the detail in logs instead.
      console.error('[auth] password reset send failed', {
        code: isEmailError(err) ? err.code : 'UNKNOWN',
        message: err?.message,
      });
    }

    return NextResponse.json(generic);
  } catch (e) {
    console.error('[auth] forgot failed', { message: e?.message });
    return NextResponse.json(generic);
  }
}
