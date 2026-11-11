import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/prisma';
import { randomToken, hashToken } from '@/lib/tokens-auth';
import { sendVerificationEmail } from '@/lib/mail';

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    const e = String(email || '').trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(e)) {
      return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
    }
    if (String(password || '').length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (await db.user.findUnique({ where: { email: e } })) {
      return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 409 });
    }

    const token = randomToken();
    const user = await db.user.create({
      data: {
        email: e,
        passwordHash: await bcrypt.hash(password, 12),
        verificationTokenHash: hashToken(token),
        verificationTokenExpiresAt: new Date(Date.now() + 86400000)
      }
    });

    try {
      await sendVerificationEmail(user, token);
      return NextResponse.json({
        ok: true,
        emailSent: true,
        message: 'Account created. We sent a verification link to your email.'
      });
    } catch (err) {
      console.error('[email] verification send failed:', err);
      return NextResponse.json({
        ok: true,
        emailSent: false,
        message: 'Account created. You can sign in now, but email delivery is not configured yet. Verify your email before enabling email alerts.'
      });
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Unable to create account.' }, { status: 500 });
  }
}
