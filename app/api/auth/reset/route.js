import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens-auth';
import { sendSecurityNotification, isEmailError } from '@/lib/email/service';
import { rateLimitResponse } from '@/lib/security/rate-limit';

// Completes a password reset. The token is single-use: on success the stored
// hash is cleared and the password is replaced.
export async function POST(req) {
  const limited = await rateLimitResponse(req, NextResponse, 'auth:reset', { limit: 15, windowMs: 15 * 60 * 1000 });
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '');
    const password = String(body.password || '');

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    const user = await db.user.findFirst({
      where: {
        resetTokenHash: hashToken(token),
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return NextResponse.json({ error: 'This reset link is invalid or expired.' }, { status: 400 });
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 12),
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });

    // Security notification is best-effort — the reset itself already worked.
    try {
      await sendSecurityNotification(user, {
        heading: 'Your password was changed',
        bodyText: 'The password for your Crypto Vault account was just changed using a reset link.',
      });
    } catch (err) {
      if (!isEmailError(err)) console.error('[auth] security email failed', { message: err?.message });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[auth] reset failed', { message: e?.message });
    return NextResponse.json({ error: 'Unable to reset password right now.' }, { status: 500 });
  }
}
