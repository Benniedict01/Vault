import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { randomToken, hashToken } from '@/lib/tokens-auth';
import { sendVerificationEmail } from '@/lib/mail';

export async function POST(req) {
  try {
    const { email } = await req.json();
    const normalized = String(email || '').trim().toLowerCase();
    const user = await db.user.findUnique({ where: { email: normalized } });

    // Keep this response generic so the endpoint does not reveal whether an account exists.
    if (!user || user.emailVerifiedAt) {
      return NextResponse.json({ ok: true, message: 'If the account exists and needs verification, a new verification email has been sent.' });
    }

    const token = randomToken();
    await db.user.update({
      where: { id: user.id },
      data: {
        verificationTokenHash: hashToken(token),
        verificationTokenExpiresAt: new Date(Date.now() + 86400000)
      }
    });

    await sendVerificationEmail(user, token);
    return NextResponse.json({ ok: true, message: 'A new verification email has been sent.' });
  } catch (e) {
    console.error('[email] verification resend failed:', e);
    return NextResponse.json({ error: 'Email delivery is not configured or the message could not be sent.' }, { status: 503 });
  }
}
