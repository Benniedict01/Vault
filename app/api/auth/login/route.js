import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/prisma';
import { createSession } from '@/lib/auth';

export async function POST(req) {
  try {
    const { email, password } = await req.json();
    const user = await db.user.findUnique({ where: { email: String(email || '').trim().toLowerCase() } });
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
      return NextResponse.json({ error: 'Incorrect email or password.' }, { status: 401 });
    }

    await createSession(user.id);
    return NextResponse.json({ ok: true, emailVerified: Boolean(user.emailVerifiedAt) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Unable to sign in.' }, { status: 500 });
  }
}
