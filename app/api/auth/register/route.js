import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/prisma';
import { randomToken, hashToken } from '@/lib/tokens-auth';
import { sendVerificationEmail, userMessage, isEmailError } from '@/lib/email/service';
import { rateLimitResponse } from '@/lib/security/rate-limit';

export async function POST(req) {
  const limited = await rateLimitResponse(req, NextResponse, 'auth:register', { limit: 10, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const e = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!/^\S+@\S+\.\S+$/.test(e)) {
      return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (await db.user.findUnique({ where: { email: e } })) {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    }

    // Only the hash of the verification token is stored; the raw token exists
    // solely inside the outbound email link and expires in 24 hours.
    const token = randomToken();
    const user = await db.user.create({
      data: {
        email: e,
        passwordHash: await bcrypt.hash(password, 12),
        verificationTokenHash: hashToken(token),
        verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    try {
      await sendVerificationEmail(user, token);
      return NextResponse.json({
        ok: true,
        emailSent: true,
        message: 'Account created. We sent a verification link to your email.',
      });
    } catch (err) {
      // Email failure must not undo account creation; the user can request a
      // new verification email at any time.
      const friendly = isEmailError(err) ? userMessage(err) : "We couldn't send the verification email. You can request a new one after signing in.";
      return NextResponse.json({
        ok: true,
        emailSent: false,
        message: `Account created. ${friendly}`,
      });
    }
  } catch (e) {
    console.error('[auth] register failed', { message: e?.message });
    return NextResponse.json({ error: 'Unable to create account.' }, { status: 500 });
  }
}
