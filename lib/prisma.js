import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Engine-less Prisma client (queryCompiler + pg driver adapter): no native
// engine binaries to download at build time. The adapter reads DATABASE_URL.
const globalForPrisma = globalThis;

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.__cryptoVaultPrisma || createClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__cryptoVaultPrisma = db;
