# Crypto Vault — Engineering Brief

Use this document as the standing brief for anyone (human or AI) changing this
codebase. Read it fully before editing. When it conflicts with a quick request,
this document wins until it is updated.

This file lives in the repository so the brief is versioned with the code. Any
change it constrains must update it in the same commit. Corrections made while
adopting it are listed in [§9](#9-change-log).

---

## 1. Role and goal

You are a senior full-stack engineer maintaining **Crypto Vault**: a watch-only
multi-chain balance monitor. Users register public wallet addresses. The server
polls balances on a schedule and emails users when funds arrive or leave.

**Non-negotiable principles, in priority order:**

1. **Never handle keys.** The product reads public chain data only. Seed phrases
   and private keys must never be requested, accepted, stored, logged, or
   transmitted. Input validation must reject anything that looks like one.
2. **Never leak secrets.** No API keys, passwords, tokens, or connection strings
   in source, logs, error messages, responses, or the repository.
3. **Fail loud, recover quietly.** Errors are logged with a reason and the
   affected unit (wallet, user, send). One failing wallet or one failing email
   must never stop the rest of a monitoring run.
4. **Stay deployable on free-tier infrastructure** unless a change is explicitly
   approved and documented as a cost decision.

---

## 2. System overview

| Layer | Implementation | Location |
|---|---|---|
| Frontend | Next.js 15 App Router, plain CSS, no UI library | `app/` |
| Landing page | Static-rendered marketing page, inline SVG icons | `app/page.js` |
| Auth | Email + password, signed session cookie via `jose`, `bcryptjs` hashes | `lib/auth.js`, `app/api/auth/*` |
| Tokens | Verification and reset tokens, stored as hashes only | `lib/tokens-auth.js` |
| Data | PostgreSQL via Prisma | `prisma/schema.prisma` |
| Chain input validation | Network registry and address/seed rejection | `lib/validation.js` |
| Balance + token monitoring | Per-network adapters, alert dispatch | `lib/monitor.js` |
| Token/indexer adapters | Blockscout and Solana token reads | `lib/tokens.js` |
| Alert decisions + email text | Pure, unit-testable rules (no DB or network imports) | `lib/alerts.js` |
| Email | Resend (HTTPS) primary, SMTP fallback | `lib/mail.js` |
| Scheduler | GitHub Actions cron calling `POST /api/monitor` | `.github/workflows/monitor.yml` |
| Hosting | Render web service (`render.yaml`) | repo root |
| Installable app | Web manifest, service worker, install banner | `public/`, `app/pwa.js` |
| Health | `GET /api/health` | `app/api/health/route.js` |
| This brief | Standing engineering document | `ENGINEERING.md` |

### Data model (Prisma, 3 models)

- `User`: email (unique), password hash, email verification state, reset-token
  hash and expiry, notification settings.
- `Wallet`: owned by a user; `(userId, chain, address)` is unique; stores last
  known native amount and last checked time. Withdrawal confirmation state
  (`lastConfirmedAmount`, `pendingDecreaseAmount`, `pendingDecreaseAt`) lives
  here — see §5.3.
- `Notification`: an alert record (deposit, withdrawal, token deposit), with
  amount, USD value, chain, and optional transaction hash. Also powers the
  "recent alerts" list. Delivery state (`sentAt`, `sendAttempts`, `sendError`)
  lives here — see §5.1.

### Request flow for an alert

1. Scheduler calls `POST /api/monitor` with `Authorization: Bearer <CRON_SECRET>`.
2. `monitorAll()` iterates wallets. For each wallet it reads the current balance
   through the network adapter.
3. It compares the current balance with the wallet's **confirmed** balance
   (`lastConfirmedAmount`, or `lastNativeAmount` for rows created before that
   column existed). A balance drop is not alerted on the first read; it is
   parked and confirmed on the next run (§5.3).
4. If the change passes the user's threshold and notification toggles, it writes
   a `Notification` row.
5. It sends the alert through `sendMail()` if the user's email is verified.
   Failure is recorded on the row, not thrown.
6. It updates `lastNativeAmount`, `lastConfirmedAmount`, `lastCheckedAt` and the
   pending-decrease fields.
7. After all wallets, `retryPendingAlerts()` retries a small batch of rows that
   were stored but never emailed.

Keep this order. Write the notification row before attempting the email, so a
failed email never loses the alert in the dashboard. Keep the balance write
before the alert so partial progress survives a crash or timeout.

---

## 3. Environment contract

| Variable | Required | Purpose | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string | Must start with `postgresql://` or `postgres://`. Used by Prisma. |
| `AUTH_SECRET` | yes | Signs session tokens | 32+ random characters. Rotating it logs everyone out. |
| `APP_URL` | yes | Public base URL, no trailing slash | Used to build verification and reset links. |
| `CRON_SECRET` | yes | Authorises `/api/monitor` | Must equal the GitHub secret `VAULT_CRON_SECRET`. |
| `RESEND_API_KEY` | recommended | Enables Resend email | If set, Resend is used instead of SMTP. |
| `EMAIL_FROM` | with Resend | Sender, e.g. `Crypto Vault <alerts@domain.com>` | Without a verified domain: `onboarding@resend.dev`, delivers only to the Resend account owner. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | fallback | Classic SMTP | Only used when `RESEND_API_KEY` is empty. Blocked on Render free tier. Port must be 465 or 587. |

GitHub Actions secrets: `VAULT_APP_URL` (the deployed URL), `VAULT_CRON_SECRET`
(same value as `CRON_SECRET`).

Removed in the current design and must not be reintroduced without a reason:
`MIN_NOTIFY_AMOUNT`, `CHECK_INTERVAL_SECONDS`, `ACCESS_TOKEN`, `VAULT_ADDRESSES`.
These belonged to the earlier standalone Node server.

---

## 4. Coding standards

- Plain JavaScript modules are used throughout. Keep it that way unless a
  migration is approved.
- Server routes must validate input before touching the database. Use
  `lib/validation.js` for addresses, chains and secret rejection.
- Never return raw database or provider errors to the client. Return a generic
  message and log the detail server-side.
- Never log: passwords, tokens, API keys, session cookies, full email bodies, or
  full addresses in bulk. Use `maskAddress()` from `lib/validation.js` (first 6
  and last 4 characters) whenever a log line identifies a wallet.
- Email content must not contain secrets. Links carry single-use or expiring
  tokens, and tokens are stored only as hashes. Alert emails are plain text.
- Keep `app/globals.css` as the single stylesheet. Do not introduce a UI
  framework without approval.
- Every new file that users can reach must work at 320px width. Check for
  horizontal overflow before merging.
- Syntax-check every changed file before handing work back. Do not claim a
  feature works unless it was run against real services or explicitly labelled
  as untested.
- Keep decision logic that has no I/O (for example `lib/alerts.js`) free of
  database and network imports, so it can be exercised with plain Node.

---

## 5. Failsafes

Each failure below has a defined fallback. Implement the fallback when touching
the related code, and do not remove existing fallbacks.

### 5.1 Email delivery

| Failure | Detection | Failsafe |
|---|---|---|
| Resend returns an error (for example, unverified domain or invalid key) | `[email] Resend send failed` in logs with status and reason | The send fails for that message. Verification and reset flows return a generic "could not send" message. The alert row is still stored. |
| Resend unreachable or slow | 15-second abort timeout, logged as `timed out` | Same as above. The alert row keeps `sentAt = null`, so `retryPendingAlerts()` tries again on the next scheduled run. |
| `RESEND_API_KEY` missing | Code falls back to SMTP | If SMTP is also unavailable on this host (Render free), the send fails with a "not configured" error. Set the key. |
| Emails land in spam | User reports, or Resend dashboard shows bounces or complaints | Add the "check your spam folder" line on verification and login screens. Verify a sending domain and add SPF, DKIM, and DMARC records. |
| No verified domain | Resend rejects recipients other than the account owner | Buy a domain (about $10/year) and verify it in Resend. Until then, testing only. |

**Implemented failsafe (alert retry).** Every alert writes a `Notification` row
before the email is attempted, and the row records `sentAt`, `sendAttempts` and
`sendError`. After each monitoring run, `retryPendingAlerts()` picks up to 20
unsent rows created in the last 24 hours for verified users and tries again,
stopping after five attempts. Rules that must be kept:

- Retry only rows whose user is verified and whose notification toggle still
  allows that type.
- Never retry anything older than 24 hours; a very old balance alert is noise.
- Never retry a row created in the last 5 minutes: this run may already have
  tried it, and a timeout that eventually delivered would be duplicated.
- Rows recorded for an unverified address are closed (`sendAttempts` set to the
  cap, `sendError = skipped: email not verified`). Keeping them queued would
  send a backlog of old alerts the moment the user verifies.
- `Notification.sentAt` defaults to `now()`. That marks rows written before
  delivery tracking existed as delivered, so a deploy never re-emails the last
  day of alerts. `recordAlert()` sets `sentAt = null` explicitly for new alerts;
  any new writer must do the same or its rows will never be retried (the safe
  direction: no duplicate emails).
- Per-row error isolation: one bad row must not stop the batch.
- Delivery is at-least-once. A crash between a successful send and the `sentAt`
  write can duplicate one email; that is preferred over losing the alert.

### 5.2 Monitoring schedule

| Failure | Detection | Failsafe |
|---|---|---|
| GitHub Actions workflow fails (secret missing, cold start) | Action run marked failed; GitHub emails the repo owner | The workflow retries three times with a 20-second delay and a 120-second timeout. Re-run manually from the Actions tab. |
| Scheduled runs stop (GitHub pauses scheduled workflows on public repos after 60 days of no activity) | No new runs in the Actions tab | Push any commit or re-enable the workflow. |
| Render free service asleep | First request is slow or times out | The retry in the workflow covers it. For reliable timing, use Render Starter. |
| Monitor run takes too long | Request timeout | `monitorAll()` processes wallets sequentially with per-wallet error isolation, the balance is written before the alert is sent, so partial progress is saved. |

**Recommended second trigger:** an external cron service (for example
cron-job.org, free tier) calling the same endpoint. If GitHub stops, the second
trigger keeps balances current.

### 5.3 Blockchain data providers

| Failure | Detection | Failsafe |
|---|---|---|
| A network's public RPC or explorer rate-limits or is down | Adapter throws, logged with the network name and a masked address | That wallet is skipped for this run. Its `lastCheckedAt` is not advanced, so it is retried next run. Other wallets continue. |
| Provider returns wrong or stale data | Balance drops unexpectedly | No withdrawal alert on a single reading. The drop is parked in `pendingDecreaseAmount` and alerted on only when the next run still shows a balance below the confirmed level. If the next reading returns to the confirmed level, the parked drop is discarded and nothing is sent. |
| A wallet references a network that has been removed | Wallet keeps working for everything else | The wallet is kept, skipped by the monitor with a log line, and still rendered in the dashboard/portfolio instead of crashing them. |
| A network's provider is permanently unavailable | Repeated failures in logs for one network | Remove or disable the network in `lib/validation.js` and notify users. Do not silently drop wallets. |

Rules for the confirmation logic (`lib/alerts.js → decideBalanceChange`):

- Compare against the **confirmed** balance, not the last raw reading.
- A drop parks the reading and sends nothing. A second consecutive reading
  below the confirmed balance confirms a withdrawal for the whole distance from
  the confirmed balance, so a multi-step drain is reported once, not lost.
- A reading back at or above the confirmed level is treated as provider lag.
  No withdrawal and no deposit is sent for that run; a genuine deposit that
  landed meanwhile is alerted on the next run once it holds.
- First ever reading for a wallet records a baseline and never alerts.

**Planned failsafe:** a list of backup RPC endpoints per network, tried in order.

### 5.4 Database

| Failure | Detection | Failsafe |
|---|---|---|
| Free Postgres expires (Render free tier, about 30 days) | Database page shows expiry; web service fails to connect | Export with `pg_dump` before expiry. Move to a paid Render Postgres plan or another managed Postgres. |
| Connection string wrong | Build fails with `the URL must start with the protocol` | Re-copy the Internal Database URL. Check the variable name is exactly `DATABASE_URL`. |
| Schema drift | `prisma db push` fails in build | Run `npx prisma db push` locally against a copy first. Do not run destructive changes against production without a backup. |

Schema changes are additive on purpose (new nullable columns with defaults), so
`prisma db push` in the Render build applies them without data loss.

### 5.5 Authentication and secrets

| Failure | Failsafe |
|---|---|
| `AUTH_SECRET` leaked | Rotate it in the environment and redeploy. All sessions are invalidated. Tell users to sign in again. |
| `CRON_SECRET` leaked | Rotate it in Render and in GitHub secrets. Anyone with the old value can trigger extra monitor runs but cannot read data. |
| `RESEND_API_KEY` leaked | Revoke it in Resend and create a new one. |
| Any credential accidentally committed | Treat it as compromised. Rotate, then remove it from history (`git filter-repo`), because deleting the file alone leaves it in past commits. |
| User forgets password | Forgot-password flow issues a time-limited reset link. Never reveal whether an email has an account. |

### 5.6 Frontend and PWA

| Failure | Failsafe |
|---|---|
| Users see a stale page after a deploy | Bump `CACHE` in `public/sw.js`. The service worker never caches `/api/*` or signed-in pages. |
| "Server Reference ID did not match" error after a deploy | The browser holds an old client bundle. Hard refresh, or close and reopen the tab. |
| Layout breaks on small phones | Run the 320px horizontal-overflow check before shipping. |

### 5.7 Hosting

| Situation | Failsafe |
|---|---|
| Render outage | Status page first. Monitoring pauses; no data is lost because the last balance is kept. Alerts resume when the service returns. |
| Need a free host for personal use | Vercel Hobby + Neon free Postgres. Hobby prohibits commercial use. Adjust the schedule to fit Neon's compute allowance. |
| Charging customers | Do not use Vercel Hobby. Use Render Starter (about $7/month) or another plan that permits commercial use. |

---

## 6. Projections and planned adaptations

These are directions, not commitments. Each needs its own design note before
implementation.

### 6.1 Notifications
- **Web push (next priority).** The app is already installable (PWA). Add VAPID
  keys, a `PushSubscription` model, a subscribe route, and a push send in the
  monitor. This works on Android and on iPhone after Add to Home Screen (iOS
  16.4+). It removes dependence on email for real-time alerts.
- **SMS or Telegram** as optional channels, behind the same notification
  interface used by email.
- **Notification interface:** introduce a single `dispatch(notification)`
  function that fans out to enabled channels. Email is one channel, not the only
  path. `lib/alerts.js` already separates "should this alert exist" from
  "deliver it", which is the seam this work should extend.

### 6.2 Chains and assets
- **New EVM networks** are a registry entry in `lib/validation.js` plus, if
  needed, an RPC override. Keep the adapter pattern: one function per family
  (EVM, Solana, Bitcoin, and future ones).
- **Token tracking expansion:** add more explorers or indexers behind the
  existing token adapter. Cap per-wallet token scans to protect provider quotas.
  Portfolio token lists are cached in-process for 60 seconds for this reason.
- **Non-EVM networks** (for example Cosmos or TON) each need a new adapter and
  validation rule. Do not generalise until a second non-EVM network is actually
  added.

### 6.3 Product features
- **Per-wallet thresholds in USD** (currently global settings): extend `Wallet`
  with an optional threshold.
- **Audit log:** an append-only table of security-relevant events (login,
  password reset, wallet added or removed).
- **Two-factor authentication** (TOTP) for accounts once there are paying users.
- Done: withdrawal detection hardening (two consecutive reads, §5.3).
- Done: price data cached for 60 seconds, and a failed price lookup no longer
  zeroes stored USD values or suppresses USD-threshold alerts.

### 6.4 Business and scale
- **Billing:** Stripe subscriptions gating wallet count and notification
  channels. Store plan limits in code, not only in the UI.
- **Commercial hosting:** Render Starter web service plus a paid Postgres plan
  as the baseline. Re-evaluate at roughly 500 active users.
- **Background worker:** move `monitorAll()` out of the request path into a
  dedicated worker process, once a single run starts exceeding the request
  timeout.
- **Native apps:** if an App Store or Play Store listing is wanted, build an
  Expo client against the same authenticated API. Do not duplicate business
  logic in the client.
- **Multi-tenant teams:** shared vaults with roles, only after the single-user
  model is stable.

### 6.5 Email deliverability roadmap
1. Now: Resend with `onboarding@resend.dev`, testing only.
2. When inviting outside users: buy a domain, verify it in Resend, set
   `EMAIL_FROM`, add SPF, DKIM, and DMARC records.
3. If Resend becomes a constraint: SMTP2GO HTTPS API as an alternate provider
   behind the same `sendMail()` interface. Requires a code change in
   `lib/mail.js`.
4. Self-hosted Postfix: not recommended on free infrastructure. Requires a VPS
   that permits port 25, a domain, reverse DNS, and ongoing reputation
   management.

---

## 7. Definition of done for any change

- [ ] Code compiles (syntax check every changed file).
- [ ] No secrets added to source, logs, or documentation.
- [ ] Failure paths log a reason and do not stop other wallets or users.
- [ ] New env vars are added to this document, `render.yaml`, and `.env.example`.
- [ ] Schema changes validated (`prisma validate`) and applied with
      `npx prisma db push` or a migration; the Render build already runs
      `db push`.
- [ ] Layout checked at 320px and 1280px.
- [ ] Behaviour verified against a real service, or explicitly marked untested
      in the handover note.
- [ ] Failsafes in section 5 still apply.

---

## 8. Handover note template

When you finish a change, report:

1. What changed, by file.
2. What was run and what was not. Be explicit.
3. Any new environment variable, GitHub secret, or manual step the owner must take.
4. Any failsafe affected, and whether it still works.

---

## 9. Change log

### 2026-10-17 — brief adopted into the repository; failsafe gaps closed

Corrections made so the document matches the code:

- §2: the token section pointed at `lib/tokens.js`; token hashing is
  `lib/tokens-auth.js`. Both are now separate rows, and `lib/alerts.js` is added.
- §2/§5.1/§5.3: the data model and request flow now describe the confirmation
  and delivery-state columns that the code uses.
- §5.5 note: alert emails are sent only to verified addresses, but a
  `Notification` row is written even for unverified users so the dashboard list
  is complete (previously those alerts were dropped entirely).

Work done in the same change: withdrawal double-confirmation, alert delivery
retry, price-failure handling, per-wallet/per-user error isolation, masked
address logging, stronger seed/private-key rejection (including the wallet label
field), and an unknown-network guard on portfolio/activity/dashboard reads.

Open recommendations, not implemented:

- Rate-limit and lock out repeated failed logins (`/api/auth/login`).
- Invalidate existing sessions after a password reset (today a reset does not
  sign other devices out).
- Verify a sending domain and publish SPF, DKIM and DMARC before inviting users.
- Add the second external cron trigger (§5.2).
- Web push (§6.1).
