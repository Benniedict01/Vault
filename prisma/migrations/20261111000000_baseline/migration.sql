-- Baseline schema matching the existing Prisma db-push database before the
-- 20261111010000_monitoring_reliability migration. Existing databases created
-- with `prisma db push` should mark this migration as applied, not execute it.
CREATE TABLE "User" (
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Wallet" (
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
CREATE UNIQUE INDEX "Wallet_userId_chain_address_key" ON "Wallet"("userId", "chain", "address");
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

CREATE TABLE "Notification" (
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
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
