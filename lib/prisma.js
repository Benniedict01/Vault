import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);

// Local preview (`npm run preview`, VAULT_PREVIEW=1) generates the Prisma client
// with `engineType = "client"`, which runs the query compiler in wasm and needs
// a driver adapter. Production generates the normal client with its native
// engine and passes no adapter, so this branch is dead there.
function clientOptions() {
  if (process.env.VAULT_PREVIEW !== '1') return undefined;
  // Loaded lazily so the adapter never becomes a production dependency.
  const { PrismaPg } = require('@prisma/adapter-pg');
  return { adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) };
}

const globalForPrisma = globalThis;
export const db = globalForPrisma.__cryptoVaultPrisma || new PrismaClient(clientOptions());
if (process.env.NODE_ENV !== 'production') globalForPrisma.__cryptoVaultPrisma = db;
