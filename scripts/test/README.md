# Test harness (dev-only)

Tools for exercising Crypto Vault without a Postgres install or production
secrets. These packages are intentionally **not** in `package.json` — install
them ad hoc:

```bash
npm install --no-save @electric-sql/pglite @electric-sql/pglite-socket
```

## Files

- `pg-server.mjs` — PostgreSQL wire-protocol server backed by PGlite (WASM
  Postgres) on `127.0.0.1:5433`. Applies the DDL mirroring
  `prisma/schema.prisma` at startup (kept in sync manually).
- `sql.mjs` — run one SQL statement against that server (seeding known tokens,
  asserting rows).
- `e2e.sh` — end-to-end suite: auth flows, verification/reset token lifecycle
  (single-use + expiry), wallet policy (second wallet requires verified email),
  watch-only guards, email failure handling, pricing-null contract
  (`nativeUsdValue: null`, never `$0.00`), monitor auth + failsafe, rate
  limiting, EmailEvent observability.

## Running

```bash
node scripts/test/pg-server.mjs &          # terminal 1
DATABASE_URL="postgres://postgres@127.0.0.1:5433/postgres" \
AUTH_SECRET="e2e-test-secret-0123456789abcdef0123456789abcdef" \
APP_URL="http://127.0.0.1:3100" \
CRON_SECRET="e2e-cron-secret-abcdef0123456789" \
npx next start -p 3100 &                    # terminal 2
CRON_SECRET="e2e-cron-secret-abcdef0123456789" bash scripts/test/e2e.sh
```

Restart both processes between full runs: the rate limiter is in-memory and the
suite intentionally trips it at the end.
