// Local-preview only: generate a Prisma client that needs no engine binary.
//
// The deployed app uses the normal generator (`prisma generate` with the query
// engine binary) and a plain `new PrismaClient()`. A sandbox without access to
// binaries.prisma.sh cannot produce that client, so the preview generates a
// second one from the same schema:
//
//   * `engineType = "client"` (the wasm query compiler), driven by
//     `@prisma/adapter-pg`. No native engine, no `prisma generate` download.
//   * same models, same field names, same database rules.
//
// The schema is derived from prisma/schema.prisma on every run, so the preview
// can never drift from the real one. lib/prisma.js uses this client only when
// VAULT_PREVIEW=1 (see the adapter hook there).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const previewDir = path.join(root, '.preview');

const GENERATOR = `generator client {
  provider        = "prisma-client-js"
  engineType      = "client"
  previewFeatures = ["queryCompiler", "driverAdapters"]
}
`;

export function localSchemaText() {
  const source = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const replaced = source.replace(/generator\s+client\s*\{[^}]*\}\s*/, GENERATOR);
  if (replaced === source) throw new Error('preview: could not find the generator block in prisma/schema.prisma');
  return replaced;
}

export function writeLocalSchema() {
  fs.mkdirSync(previewDir, { recursive: true });
  const target = path.join(previewDir, 'schema.prisma');
  fs.writeFileSync(target, localSchemaText());
  return target;
}

function runGenerate(schemaPath, env) {
  const prisma = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prisma, 'generate', '--schema', schemaPath], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/**
 * Prisma cannot download its engine binaries in a network-restricted sandbox.
 * If that is what failed, point it at stand-ins: `prisma generate` only needs
 * the files to exist (with `engineType = "client"` the libquery engine is never
 * loaded, and the schema-engine stub is never called for a plain generate).
 * Machines with normal network access never take this path.
 */
function offlineEngineEnv() {
  const enginesDir = path.join(root, 'node_modules/@prisma/engines');
  fs.mkdirSync(enginesDir, { recursive: true });
  const stub = path.join(enginesDir, 'libquery_engine-debian-openssl-3.0.x.so.node');
  if (!fs.existsSync(stub)) fs.writeFileSync(stub, 'placeholder: the preview uses the wasm query compiler\n');

  fs.mkdirSync(previewDir, { recursive: true });
  const shim = path.join(previewDir, 'schema-engine-stub.sh');
  fs.writeFileSync(shim, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(shim, 0o755);

  return {
    PRISMA_QUERY_ENGINE_LIBRARY: stub,
    PRISMA_SCHEMA_ENGINE_BINARY: shim,
    PRISMA_CLI_QUERY_ENGINE_TYPE: 'library',
  };
}

export function generatePreviewClient() {
  const schemaPath = writeLocalSchema();
  let attempt = runGenerate(schemaPath, {});
  if (attempt.ok) return { offline: false, output: attempt.output };

  const downloadFailed = /binaries\.prisma\.sh|socket disconnected|ETIMEDOUT|ENOTFOUND/i.test(attempt.output);
  if (!downloadFailed) {
    throw new Error(`preview: prisma generate failed\n${attempt.output}`);
  }

  console.log('[preview] prisma engine download is blocked here; using the wasm query compiler');
  attempt = runGenerate(schemaPath, offlineEngineEnv());
  if (!attempt.ok) throw new Error(`preview: prisma generate failed\n${attempt.output}`);
  return { offline: true, output: attempt.output };
}

if (process.argv[1] && process.argv[1].endsWith('generate.mjs')) {
  const { offline } = generatePreviewClient();
  console.log(`[preview] Prisma client generated${offline ? ' (offline engine stubs)' : ''}`);
}
