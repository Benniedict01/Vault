// Authentication server configuration (Better Auth).
//
// Better Auth owns sign-up, sign-in, sessions, email verification and password
// reset. This file is the only place that configures it; the browser talks to
// it through lib/auth-client.js and app/api/auth/[...all]/route.js.
//
// Passwords stay on bcrypt. Better Auth's default is scrypt, but every existing
// account was created with bcryptjs, so the custom hash/verify below is what
// keeps old passwords valid. New passwords are hashed with the same function.

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';
import { db } from './prisma';
import { sendVerificationEmail, sendPasswordResetEmail, sendExistingAccountEmail } from './mail';

const BCRYPT_ROUNDS = 12;
const configuredSecret = process.env.AUTH_SECRET;
const DEV_SECRET = 'development-only-change-me-development-only';

if (
  process.env.NODE_ENV === 'production' &&
  (!configuredSecret || configuredSecret.length < 32 || configuredSecret === 'development-only-change-me')
) {
  throw new Error('AUTH_SECRET must be set to a random value of at least 32 characters in production.');
}

const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const devOrigins = process.env.NODE_ENV === 'production'
  ? []
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

export const auth = betterAuth({
  appName: 'Crypto Vault',
  baseURL: appUrl,
  secret: configuredSecret || DEV_SECRET,
  trustedOrigins: [...devOrigins, appUrl],

  database: prismaAdapter(db, { provider: 'postgresql' }),

  // 30 days, refreshed at most once a day (matches the previous session cookie).
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },

  user: {
    additionalFields: {
      // Written only by afterEmailVerification below, never by the client.
      emailVerifiedAt: { type: 'date', required: false, input: false },
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // Sign-up returns to the "check your email, then sign in" screen, as before.
    autoSignIn: false,
    // Product rule (README): signing in does not require a verified address;
    // verification is required before alerts are emailed and before a second
    // wallet can be added.
    requireEmailVerification: false,
    // A password reset ends sessions on other devices. This was an open item in
    // ENGINEERING.md before; Better Auth provides it directly.
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    password: {
      hash: (password) => bcrypt.hash(password, BCRYPT_ROUNDS),
      verify: ({ hash, password }) => bcrypt.compare(password, hash),
    },
    // Tells the real owner that a duplicate sign-up was attempted. The sign-up
    // response itself stays generic.
    onExistingUserSignUp: async ({ user }) => {
      try {
        await sendExistingAccountEmail(user, `${appUrl}/login`);
      } catch (error) {
        console.error(`[email] existing-account notice failed (user ${user.id}):`, error?.message);
      }
    },
    sendResetPassword: async ({ user, url }) => {
      try {
        await sendPasswordResetEmail(user, url);
      } catch (error) {
        // Never let delivery failure reveal whether the address exists, and
        // never surface the provider error to the caller. Log the reason only.
        console.error(`[email] password reset send failed (user ${user.id}):`, error?.message);
      }
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: false,
    expiresIn: 60 * 60 * 24,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await sendVerificationEmail(user, url);
      } catch (error) {
        // The account still exists; the user can request a new link from
        // /resend-verification once delivery works. Failing sign-up here would
        // lose the account because of an email outage.
        console.error(`[email] verification send failed (user ${user.id}):`, error?.message);
      }
    },
    afterEmailVerification: async (user) => {
      try {
        await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      } catch (error) {
        // Verification itself already succeeded; only the display timestamp was lost.
        console.error(`[auth] could not record emailVerifiedAt (user ${user.id}):`, error?.message);
      }
    },
  },

  // Tokens are stored as SHA-256 hashes; the raw token exists only in the email.
  verification: {
    storeIdentifier: 'hashed',
  },

  // Sign-in, sign-up and reset are rate limited per IP. Defaults are on in
  // production; this keeps them on everywhere and tightens the sensitive paths.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 60, max: 5 },
      '/send-verification-email': { window: 60, max: 5 },
    },
  },
});

/**
 * The signed-in user id, or null. Every API route uses this; it reads the
 * session from the request cookies through Better Auth.
 */
export async function getSessionUserId() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user?.id ?? null;
  } catch (error) {
    console.error('[auth] session lookup failed:', error?.message);
    return null;
  }
}
