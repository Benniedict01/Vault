import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/prisma';
import { createSession } from '@/lib/auth';
import { rateLimitResponse, check } from '@/lib/security/rate-limit';

export async function POST(req) {
  // Two layers: per-IP and per-email-attempt buckets slow credential stuffing.
  const ipLimited = await rateLimitResponse(req, NextResponse, 'auth:login:ip', { limit: 20, windowMs: 5 * 60 * 1000 });
  if (ipLimited) return ipLimited;

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    const emailGate = check(`auth:login:email:${email}`, { limit: 10, windowMs: 5 * 60 * 1000 });
    if (!emailGate.ok) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(emailGate.retryAfterSeconds) } }
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }

    await createSession(user.id);
    return NextResponse.json({ ok: true, emailVerified: Boolean(user.emailVerifiedAt) });
  } catch (e) {
    console.error('[auth] login failed', { message: e?.message });
    return NextResponse.json({ error: 'Unable to sign in.' }, { status: 500 });
  }
}
