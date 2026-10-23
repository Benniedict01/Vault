// Local-preview only: a Postgres server, in the repo's own data directory.
//
// Two ways to get one:
//   1. DATABASE_URL is already set -> use that database (real Postgres, Docker,
//      Neon, whatever the developer has). Nothing is started here.
//   2. Otherwise PGlite (Postgres compiled to wasm) is started on
//      postgres://postgres:postgres@127.0.0.1:55432/postgres and kept in
//      .preview/pgdata, so accounts and wallets survive a restart.
//
// PGlite is the same Postgres engine, not an emulator, and Prisma talks to it
// over the real wire protocol. It is a development convenience: fewer features
// than a full server (no extensions, no roles), which is why it is only used
// when no DATABASE_URL is configured.

import fs from 'node:fs';
import path from 'node:path';
import { ddlFor, parseSchema } from './ddl.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const previewDir = path.join(root, '.preview');

export const DEFAULT_PREVIEW_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable';

export async function startDatabase() {
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, own: false };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { createServer } = await import('pglite-server');

  const dataDir = process.env.PREVIEW_DB_DIR || path.join(previewDir, 'pgdata');
  fs.mkdirSync(dataDir, { recursive: true });

  const db = new PGlite(`file://${dataDir}`);
  await db.waitReady;

  const port = Number(process.env.PREVIEW_DB_PORT || 55432);
  const server = createServer(db);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return { url: DEFAULT_PREVIEW_URL, own: true, db, server };
}

/** Create or update the tables. Safe to run on every start. */
export async function ensureTables(db, schemaPath) {
  const schemaText = fs.readFileSync(schemaPath, 'utf8');
  const datamodel = parseSchema(schemaText);
  const statements = ddlFor(datamodel, schemaText);
  for (const statement of statements) await db.exec(statement);
  return datamodel.models.map((m) => m.name);
}

export async function stopDatabase(handle) {
  if (!handle?.own) return;
  await new Promise((resolve) => handle.server.close(resolve));
  await handle.db.close();
}
