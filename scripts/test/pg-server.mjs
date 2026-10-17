// Dev/test-only: a real PostgreSQL wire-protocol server backed by PGlite
// (WASM Postgres). Lets the unmodified app run end-to-end in environments
// without a Postgres install. NOT used in production.
//
//   node scripts/test/pg-server.mjs
//
// Listens on 127.0.0.1:5433 and applies the Prisma schema DDL at startup.

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = Number(process.env.PGLITE_PORT || 5433);

// Mirrors prisma/schema.prisma (kept in sync manually for the test harness).
const DDL = `
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "emailVerifiedAt" TIMESTAMP(3),
  "verificationTokenHash" TEXT,
  "verificationTokenExpiresAt" TIMESTAMP(3),
  "resetTokenHash" TEXT,
  "resetTokenExpiresAt" TIMESTAMP(3),
  "tokenMonitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
  "notifyDeposits" BOOLEAN NOT NULL DEFAULT true,
  "notifyWithdrawals" BOOLEAN NOT NULL DEFAULT false,
  "notifyTokenDeposits" BOOLEAN NOT NULL DEFAULT true,
  "minimumNotificationUsd" TEXT NOT NULL DEFAULT '0',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "Wallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "chain" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "lastNativeAmount" TEXT NOT NULL DEFAULT '0',
  "lastNativeUsdValue" TEXT NOT NULL DEFAULT '0',
  "lastCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Wallet_userId_chain_address_key" ON "Wallet"("userId","chain","address");
CREATE INDEX IF NOT EXISTS "Wallet_userId_idx" ON "Wallet"("userId");

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "chain" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "usdValue" TEXT,
  "txHash" TEXT,
  "type" TEXT NOT NULL DEFAULT 'deposit',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId","createdAt");

CREATE TABLE IF NOT EXISTS "EmailEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "status" TEXT NOT NULL,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EmailEvent_userId_createdAt_idx" ON "EmailEvent"("userId","createdAt");
CREATE INDEX IF NOT EXISTS "EmailEvent_type_status_createdAt_idx" ON "EmailEvent"("type","status","createdAt");

CREATE TABLE IF NOT EXISTS "ProcessedEvent" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "userId" TEXT,
  "walletId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedEvent_key_key" ON "ProcessedEvent"("key");
CREATE INDEX IF NOT EXISTS "ProcessedEvent_walletId_createdAt_idx" ON "ProcessedEvent"("walletId","createdAt");
CREATE INDEX IF NOT EXISTS "ProcessedEvent_userId_createdAt_idx" ON "ProcessedEvent"("userId","createdAt");
`;

const db = await PGlite.create();
await db.exec(DDL);

// maxConnections must exceed the app's pg pool size or the multiplexer
// terminates newcomers (default is 1).
const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1', maxConnections: 10 });
await server.start();
console.log(`[pg-server] PGlite wire server listening on 127.0.0.1:${PORT}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  });
}
