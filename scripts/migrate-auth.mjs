// One-off, idempotent migration from the hand-rolled auth tables to Better Auth.
//
// What it does, per existing user:
//   1. Fills User.name (Better Auth requires one) from the email local part.
//   2. Sets User.emailVerified from the legacy User.emailVerifiedAt timestamp.
//   3. Copies the bcrypt hash from User.passwordHash into a credential Account
//      row, which is where Better Auth looks it up on sign-in.
//   4. Nulls the legacy hash and token columns (they are no longer read).
//
// It is safe to run more than once, and safe on an empty database. It prints
// counts only: no addresses, no hashes, no tokens.
//
// Run after `prisma db push` and before the new version serves traffic. The
// Render build command does this automatically.

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function displayName(email) {
  const local = String(email || '').split('@')[0].replace(/[._+-]+/g, ' ').trim();
  const name = local.slice(0, 60);
  return name || 'Crypto Vault user';
}

async function main() {
  const users = await db.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      emailVerifiedAt: true,
      passwordHash: true,
    },
  });

  let named = 0;
  let verified = 0;
  let linked = 0;
  let cleared = 0;

  for (const user of users) {
    const data = {};

    if (!user.name || !user.name.trim()) {
      data.name = displayName(user.email);
      named += 1;
    }

    // Anyone verified under the old flow stays verified. The boolean, not the
    // timestamp, is what Better Auth checks.
    if (!user.emailVerified && user.emailVerifiedAt) {
      data.emailVerified = true;
      verified += 1;
    }

    if (Object.keys(data).length) {
      await db.user.update({ where: { id: user.id }, data });
    }

    if (!user.passwordHash) continue;

    const existing = await db.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
      select: { id: true },
    });

    if (!existing) {
      await db.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: user.passwordHash,
        },
      });
      linked += 1;
    }

    // Only clear the legacy copy once the credential row is known to exist.
    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: null,
        verificationTokenHash: null,
        verificationTokenExpiresAt: null,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });
    cleared += 1;
  }

  console.log(
    `[migrate-auth] users=${users.length} named=${named} verified=${verified} ` +
    `credentialAccountsCreated=${linked} legacyPasswordsCleared=${cleared}`
  );
}

main()
  .catch((error) => {
    // Message only: the stack can contain query parameters.
    console.error('[migrate-auth] failed:', error?.code || error?.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
