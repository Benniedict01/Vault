import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis;
export const db = globalForPrisma.__cryptoVaultPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__cryptoVaultPrisma = db;
