import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
const COOKIE = 'cv_session';
const configuredSecret = process.env.AUTH_SECRET;
if (process.env.NODE_ENV === 'production' && (!configuredSecret || configuredSecret.length < 32 || configuredSecret === 'development-only-change-me')) {
  throw new Error('AUTH_SECRET must be set to a random value of at least 32 characters in production.');
}
const secret = new TextEncoder().encode(configuredSecret || 'development-only-change-me');
export async function createSession(userId) {
  const token = await new SignJWT({ userId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
}
export async function clearSession() { (await cookies()).delete(COOKIE); }
export async function getSessionUserId() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try { return (await jwtVerify(token, secret)).payload.userId || null; } catch { return null; }
}
