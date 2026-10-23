#!/usr/bin/env node
// Local preview: run the real app, fully, on this machine.
//
//   npm run preview
//
// What runs:
//   * Postgres (PGlite over the real wire protocol) unless DATABASE_URL is set
//   * the Prisma client generated from prisma/schema.prisma
//   * the tables, created from that same schema
//   * `next dev`, so edits reload
//
// Nothing here is a mock: Better Auth, the API routes, the monitor and the
// alert pipeline are the code that ships. The two differences from production
// are deliberate and both gated on VAULT_PREVIEW=1:
//   * email is written to .preview/outbox.jsonl instead of being sent, so the
//     verification and reset links are visible at /dev/outbox (Plunk is not
//     called, no key is needed)
//   * Better Auth accepts the current origin, because the preview is served
//     from a proxied host rather than APP_URL

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { generatePreviewClient } from './generate.mjs';
import { ensureTables, startDatabase, stopDatabase } from './db.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const previewDir = path.join(root, '.preview');
fs.mkdirSync(previewDir, { recursive: true });

const port = Number(process.env.PORT || 3000);
const outbox = path.join(previewDir, 'outbox.jsonl');

console.log('[preview] generating the Prisma client from prisma/schema.prisma');
generatePreviewClient();

console.log('[preview] starting the database');
const handle = await startDatabase();
if (handle.own) {
  const models = await ensureTables(handle.db, path.join(root, 'prisma/schema.prisma'));
  console.log(`[preview] tables ready: ${models.join(', ')}`);
} else {
  console.log('[preview] using DATABASE_URL; expecting the tables to exist already');
  console.log('[preview]   (another terminal: npx prisma db push)');
}

// A fresh random secret each run. Nothing is baked into the repo, and nothing
// carries over, so a restart only invalidates the sessions of this preview.
const secret = process.env.AUTH_SECRET || randomBytes(32).toString('hex');

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: handle.url,
  AUTH_SECRET: secret,
  APP_URL: process.env.APP_URL || `http://localhost:${port}`,
  PLUNK_SECRET_KEY: process.env.PLUNK_SECRET_KEY || '',
  VAULT_PREVIEW: '1',
  VAULT_PREVIEW_OUTBOX: outbox,
  NEXT_TELEMETRY_DISABLED: '1',
  PORT: String(port),
};

// Keep the previous inbox so a reload does not hide the last email, but cap it.
if (fs.existsSync(outbox) && fs.statSync(outbox).size > 2_000_000) fs.rmSync(outbox);

console.log(`[preview] app: http://localhost:${port}   inbox: http://localhost:${port}/dev/outbox`);

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const next = spawn(process.execPath, [nextBin, 'dev', '-p', String(port), '-H', '0.0.0.0'], {
  cwd: root,
  env,
  stdio: 'inherit',
});

const shutdown = async (signal) => {
  next.kill(signal);
  await stopDatabase(handle);
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
next.on('exit', async (code) => {
  await stopDatabase(handle);
  process.exit(code ?? 0);
});
