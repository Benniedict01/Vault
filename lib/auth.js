import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

const COOKIE = 'cv_session';

// Resolved lazily so `next build` can evaluate route modules without runtime
// secrets present. In production a missing/weak AUTH_SECRET still fails fast —
// at the first session operation, before any token is signed or accepted.
function getSecret() {
  const configured = process.env.AUTH_SECRET;
  if (
    process.env.NODE_ENV === 'production' &&
    (!configured || configured.length < 32 || configured === 'development-only-change-me')
  ) {
    throw new Error('AUTH_SECRET must be set to a random value of at least 32 characters in production.');
  }
  return new TextEncoder().encode(configured || 'development-only-change-me');
}

export async function createSession(userId) {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getSessionUserId() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    return (await jwtVerify(token, getSecret())).payload.userId || null;
  } catch {
    return null;
  }
}
