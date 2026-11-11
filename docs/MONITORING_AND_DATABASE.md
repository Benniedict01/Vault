# Monitoring reliability and database operations

## Monitoring changes

- The GitHub Actions monitor runs every 15 minutes by default. This leaves idle time for Neon Free compute to scale to zero instead of intentionally keeping it active with a five-minute keepalive cadence. Change the cron to `*/5 * * * *` only if five-minute alert latency is more important than the additional database compute usage.
- The dashboard refreshes portfolio/wallet/settings data every 60 seconds and loads indexed activity only on initial/manual refresh, rather than polling the activity indexer every five seconds.
- Wallets are processed with a bounded concurrency of four; one wallet's RPC/indexer failure does not stop other wallets.
- Database-backed expiring locks prevent two monitor workers from processing the same wallet or running two global scans at once.
- Native balance snapshots and ERC-20 transfer indexing have independent timestamps. A failed token-indexer request throws and cannot advance the token cursor.
- Token indexing reads a two-minute overlap window and uses a unique event key to suppress repeats. Blockscout pagination is followed up to a safety limit; an incomplete backlog fails visibly rather than advancing the cursor.
- Notification creation and email-outbox creation are one database transaction. Email delivery is retried with exponential backoff (up to eight attempts); stale `sending` jobs are reclaimed. The queued email body is cleared after successful delivery so the outbox does not become a permanent message archive.
- Resend requests use the outbox record ID as an idempotency key. SMTP providers may not offer the same duplicate-send protection.
- Native-asset notifications are explicitly described as balance-change detections, not transaction-level proof. Multiple chain transactions between polling runs can appear as one net balance change.

## Wallet deletion export

The dashboard downloads a CSV before issuing the wallet deletion request. If export fails, deletion is cancelled. The CSV contains the alert/event records Crypto Vault has retained for that wallet. It is **not** a full blockchain statement: native coin events are balance snapshots, and the current app does not persist every transaction from every chain. Token-deposit alerts include the transaction hash when the indexer provides one.

The CSV is generated on demand and streamed to the browser. It is not stored in PostgreSQL or an object-storage bucket. Wallet deletion cascades to that wallet's notifications and queued email records, as intended by the product's deletion policy.

## File and object storage policy

PostgreSQL stores relational application data only: users, wallet metadata, alert records, monitoring cursors, locks, and ordinary text required to retry email delivery. The application does not store log archives, JSON database dumps, base64-encoded files, or CSV exports in database columns. There is no need to call Supabase Storage or Neon Object Storage for this release because no persistent file object is created. If later adding downloadable backup archives or uploaded files, put those objects in object storage and keep only their object key, size, checksum, and metadata in PostgreSQL.

## Prisma migrations

The pre-existing deployment was created with `prisma db push`, so it may not have a Prisma migration history. The migration set now contains:

1. `20261111000000_baseline`: describes the original schema. On an existing database that already has those tables, mark this baseline as applied; do not execute its CREATE TABLE statements.
2. `20261111010000_monitoring_reliability`: adds the independent token cursor, event deduplication key, email outbox, and monitor locks.

For an existing database whose schema matches the original `prisma/schema.prisma` before these updates:

1. Take a full PostgreSQL backup first.
2. Point `DATABASE_URL` at that existing database using a direct (non-pooled) connection.
3. Run `npx prisma migrate resolve --applied 20261111000000_baseline` once.
4. Run `npx prisma migrate deploy`.
5. Run `npx prisma migrate status` and verify the new columns/tables before deploying the application code.

For a brand-new empty database, run `npx prisma migrate deploy`; it creates the baseline schema and applies the reliability migration. Do not run the baseline marker against an empty database.

Do not use `prisma db push` as the ongoing production migration process. The Render Free web service does not support a separate pre-deploy command. This release therefore runs `npx prisma migrate deploy` in the build command, after Prisma Client generation and before the Next.js build. This is safe to repeat: Prisma applies only migrations not already recorded as applied. Set both `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) before deploying. For a brand-new empty Neon database, the baseline and reliability migrations are applied automatically. Do not use `prisma db push` alongside this migration workflow.

## PostgreSQL provider notes

The app uses Prisma with standard PostgreSQL and does not depend on Supabase Auth, Supabase Storage, or Supabase Edge Functions. Neon is therefore a good fit if the requirement is managed PostgreSQL only. Use Neon's pooled connection string as `DATABASE_URL` for application requests, and the direct (unpooled) connection string as `DIRECT_URL` for Prisma migrations and database dumps. Neon Free currently documents 1 GB storage per project, 100 CU-hours per project/month, and compute scale-to-zero after five minutes of inactivity. A query wakes the compute; it does not mean the database project is paused.

Supabase is the better fit if the product will actively use its integrated Auth, Storage buckets, Realtime, or Edge Functions. Its Free plan currently documents 500 MB database size and project pausing after a week of insufficient database activity. Supabase Storage is separate from PostgreSQL, but this release does not need it because the CSV is generated and downloaded directly.

Provider quotas and pricing can change; check the provider's current plan page before migration. Keep an independent backup regardless of provider.
