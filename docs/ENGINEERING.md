# Crypto Vault — Engineering Brief

> This is the standing brief for anyone (human or AI) changing this codebase.
> Read it fully before editing. When it conflicts with a quick request, this
> document wins until it is updated.
>
> **Status: 2026-10-17.** The failsafes marked *built* below are implemented and
> covered by the code in this repository. Everything in section 6 is still a
> projection and needs its own design note before implementation. See the
> changelog at the end for what changed and when.

---

## 1. Role and goal

You are a senior full-stack engineer maintaining **Crypto Vault**: a watch-only multi-chain balance monitor. Users register public wallet addresses. The server polls balances on a schedule and emails users when funds arrive or leave.

**Non-negotiable principles, in priority order:**

1. **Never handle keys.** The product reads public chain data only. Seed phrases and private keys must never be requested, accepted, stored, logged, or transmitted. Input validation must reject anything that looks like one.
2. **Never leak secrets.** No API keys, passwords, tokens, or connection strings in source, logs, error messages, responses, or the repository.
3. **Fail loud, recover quietly.** Errors are logged with a reason and the affected unit (wallet, user, send). One failing wallet or one failing email must never stop the rest of a monitoring run.
4. **Stay deployable on free-tier infrastructure** unless a change is explicitly approved and documented as a cost decision.

---

## 2. System overview

| Layer | Implementation | Location |
|---|---|---|
| Frontend | Next.js 15 App Router, plain CSS, no UI library | `app/` |
| Landing page | Static-rendered marketing page, inline SVG icons | `app/page.js` |
| Auth | Email + password, signed session cookie via `jose`, `bcryptjs` hashes | `lib/auth.js`, `app/api/auth/*` |
| Tokens (auth) | Verification and reset tokens, stored as hashes only | `lib/tokens-auth.js` |
| Data | PostgreSQL via Prisma | `prisma/schema.prisma` |
| Chain input validation | Network registry and address/seed rejection | `lib/validation.mjs` |
| Balance + token monitoring | Per-network adapters, alert dispatch | `lib/monitor.js` |
| Token balances | Explorer adapters with a short cache | `lib/tokens.js` |
| Alert rules | Pure decision logic, unit tested | `lib/alerts.mjs` |
| Email | Resend (HTTPS) primary, SMTP fallback | `lib/mail.js` |
| Scheduler | GitHub Actions cron calling `POST /api/monitor` | `.github/workflows/monitor.yml` |
| Hosting | Render web service (`render.yaml`) | repo root |
| Installable app | Web manifest, service worker, install banner | `public/`, `app/pwa.js` |
| Health | `GET /api/health` | `app/api/health/route.js` |

### Data model (Prisma, 3 models)

- `User`: email (unique), password hash, email verification state, reset-token hash and expiry, notification settings.
- `Wallet`: owned by a user; `(userId, chain, address)` is unique; stores last known native amount and last checked time. Also stores the *pending withdrawal* that is waiting for a second confirming read.
- `Notification`: an alert record (deposit or withdrawal), with amount, USD value, chain, and optional transaction hash. Also powers the "recent alerts" list and carries the email delivery state (`emailStatus`, `emailSentAt`, `emailAttempts`, `emailLastError`, `emailLastAttemptAt`).

### Request flow for an alert

1. Scheduler calls `POST /api/monitor` with `Authorization: Bearer <CRON_SECRET>`.
2. `monitorAll()` iterates wallets. For each wallet it reads the current balance through the network adapter.
3. It compares the current balance with `lastNativeAmount`. If the change passes the user's threshold and notification toggles, it writes a `Notification` row.
4. It sends the alert through `sendMail()` if the user's email is verified.
5. It updates `lastNativeAmount` and `lastCheckedAt`.

Keep this order. Write the notification row before attempting the email, so a failed email never loses the alert in the dashboard.

> Implementation note: steps 3 and 5 run inside one database transaction, so an
> alert is never lost and never duplicated. Step 4 runs after the transaction
> and only marks the row as `failed` when it does not go out - the row itself
> is never removed. A withdrawal additionally needs a second confirming read
> (see 5.3).

---

## 3. Environment contract

| Variable | Required | Purpose | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string | Must start with `postgresql://` or `postgres://`. Used by Prisma. |
| `AUTH_SECRET` | yes | Signs session tokens | 32+ random characters. Rotating it logs everyone out. |
| `APP_URL` | yes | Public base URL, no trailing slash | Used to build verification and reset links. |
| `CRON_SECRET` | yes | Authorises `/api/monitor` | Must equal the GitHub secret `VAULT_CRON_SECRET`. Compared in constant time. |
| `RESEND_API_KEY` | recommended | Enables Resend email | If set, Resend is used instead of SMTP. |
| `EMAIL_FROM` | with Resend | Sender, e.g. `Crypto Vault <alerts@domain.com>` | Without a verified domain: `onboarding@resend.dev`, delivers only to the Resend account owner. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | fallback | Classic SMTP | Only used when `RESEND_API_KEY` is empty. Blocked on Render free tier. Port must be 465 or 587. |

GitHub Actions secrets: `VAULT_APP_URL` (the deployed URL), `VAULT_CRON_SECRET` (same value as `CRON_SECRET`).

Removed in the current design and must not be reintroduced without a reason: `MIN_NOTIFY_AMOUNT`, `CHECK_INTERVAL_SECONDS`, `ACCESS_TOKEN`, `VAULT_ADDRESSES`. These belonged to the earlier standalone Node server.

All of these are declared in `.env.example` and `render.yaml`.

---

## 4. Coding standards

- Plain JavaScript modules are used throughout. Keep it that way unless a migration is approved.
- Server routes must validate input before touching the database. Use `lib/validation.mjs` for addresses and chains.
- Never return raw database or provider errors to the client. Return a generic message and log the detail server-side.
- Never log: passwords, tokens, API keys, session cookies, full email bodies, or full addresses in bulk. Logging a masked address (first 6 and last 4 characters) is acceptable.
- Email content must not contain secrets. Links carry single-use or expiring tokens, and tokens are stored only as hashes.
- Keep `app/globals.css` as the single stylesheet. Do not introduce a UI framework without approval.
- Every new file that users can reach must work at 320px width. Check for horizontal overflow before merging.
- Syntax-check every changed file before handing work back. Do not claim a feature works unless it was run against real services or explicitly labelled as untested.

> Implementation notes:
>
> - `lib/validation.mjs`, `lib/alerts.mjs`, `lib/cache.mjs`, `lib/log.mjs` and `lib/prices.mjs` use the `.mjs` extension so they can be imported directly by `node --test` without a bundler. The `.js` modules in `lib/` are bundled by Next.js only.
> - `npm run check` parses every JavaScript file with the same parser the build uses. `node --check` is not enough: it skips files that contain `import` statements and does not understand JSX.
> - `lib/log.mjs` holds the masking helpers (`maskAddress`, `maskEmail`, `sanitizeReason`, `safeEndpoint`). Use them instead of logging raw values.

---

## 5. Failsafes

Each failure below has a defined fallback. Implement the fallback when touching the related code, and do not remove existing fallbacks.

### 5.1 Email delivery

| Failure | Detection | Failsafe |
|---|---|---|
| Resend returns an error (for example, unverified domain or invalid key) | `[email] Resend send failed` in logs with status and reason | The send fails for that message. Verification and reset flows return a generic "could not send" message. The alert row is still stored. **Built: the row is marked `failed` and retried by the monitor job.** |
| Resend unreachable or slow | 15-second abort timeout, logged as `timed out` | Same as above. Retry on the next scheduled run for alerts. **Built: retry happens up to five times, ten minutes apart.** |
| `RESEND_API_KEY` missing | Code falls back to SMTP | If SMTP is also unavailable on this host (Render free), the send fails with a "not configured" error. Set the key. |
| Emails land in spam | User reports, or Resend dashboard shows bounces or complaints | Add the "check your spam folder" line on verification and login screens. Verify a sending domain and add SPF, DKIM, and DMARC records. |
| No verified domain | Resend rejects recipients other than the account owner | Buy a domain (about $10/year) and verify it in Resend. Until then, testing only. |

**Planned failsafe (not yet built):** ~~a `pending_emails` table or a `sentAt` column on `Notification`, so unsent alerts are retried by the monitor job and cannot be lost on a transient failure.~~
**Status: built.** `Notification.emailStatus` (`pending` / `sent` / `failed` / `skipped`), `emailSentAt`, `emailAttempts`, `emailLastError` and `emailLastAttemptAt` carry the delivery state. `retryUnsentAlerts()` in `lib/monitor.js` re-sends `pending` and `failed` rows. `skipped` rows (unverified address, notifications switched off, price unknown) are never retried.

### 5.2 Monitoring schedule

| Failure | Detection | Failsafe |
|---|---|---|
| GitHub Actions workflow fails (secret missing, cold start) | Action run marked failed; GitHub emails the repo owner | The workflow retries three times with a 20-second delay and a 120-second timeout. Re-run manually from the Actions tab. |
| Scheduled runs stop (GitHub pauses scheduled workflows on public repos after 60 days of no activity) | No new runs in the Actions tab | Push any commit or re-enable the workflow. |
| Render free service asleep | First request is slow or times out | The retry in the workflow covers this. For reliable timing, use Render Starter. |
| Monitor run takes too long | Request timeout | Keep `monitorAll()` processing wallets sequentially with per-wallet error isolation, so partial progress is saved. |

**Recommended second trigger:** an external cron service (for example cron-job.org, free tier) calling the same endpoint. If GitHub stops, the second trigger keeps balances current.

### 5.3 Blockchain data providers

| Failure | Detection | Failsafe |
|---|---|---|
| A network's public RPC or explorer rate-limits or is down | Adapter throws, logged with the network name | That wallet is skipped for this run. Its `lastCheckedAt` is not advanced, so it is retried next run. Other wallets continue. **Built: every chain has a list of fallback endpoints that are tried in order.** |
| Provider returns wrong or stale data | Balance drops to zero unexpectedly | Do not emit a withdrawal alert without a second confirmation on the next run. **Built: a withdrawal is only alerted after a second, consecutive read confirms the low balance.** |
| A network's provider is permanently unavailable | Repeated failures in logs for one network | Remove or disable the network in `lib/validation.mjs` and notify users. Do not silently drop wallets. |

**Planned failsafe:** ~~a list of backup RPC endpoints per network, tried in order.~~
**Status: built.** `CHAINS[chain].rpcs` is an ordered list, `CHAINS[chain].apis` covers the Bitcoin address API. The monitor tries them one by one and only skips the wallet when all of them fail.

### 5.4 Database

| Failure | Detection | Failsafe |
|---|---|---|
| Free Postgres expires (Render free tier, about 30 days) | Database page shows expiry; web service fails to connect | Export with `pg_dump` before expiry. Move to a paid Render Postgres plan or another managed Postgres. |
| Connection string wrong | Build fails with `the URL must start with the protocol` | Re-copy the Internal Database URL. Check the variable name is exactly `DATABASE_URL`. |
| Schema drift | `prisma db push` fails in build | Run `npx prisma db push` locally against a copy first. Do not run destructive changes against production without a backup. |

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

These are directions, not commitments. Each needs its own design note before implementation.

### 6.1 Notifications
- **Web push (next priority).** The app is already installable (PWA). Add VAPID keys, a `PushSubscription` model, a subscribe route, and a push send in the monitor. This works on Android and on iPhone after Add to Home Screen (iOS 16.4+). It removes dependence on email for real-time alerts.
- **SMS or Telegram** as optional channels, behind the same notification interface used by email.
- **Notification interface:** introduce a single `dispatch(notification)` function that fans out to enabled channels. Email is one channel, not the only path.

### 6.2 Chains and assets
- **New EVM networks** are a registry entry in `lib/validation.mjs` plus, if needed, an RPC override. Keep the adapter pattern: one function per family (EVM, Solana, Bitcoin, and future ones).
- **Token tracking expansion:** add more explorers or indexers behind the existing token adapter. Cap per-wallet token scans to protect provider quotas. **Partly built: token balances are cached for 30 seconds and activity for 60 seconds.**
- **Non-EVM networks** (for example Cosmos or TON) each need a new adapter and validation rule. Do not generalise until a second non-EVM network is actually added.

### 6.3 Product features
- **Withdrawal detection hardening:** require two consecutive reads before a withdrawal alert, to avoid false alarms from provider lag. **Built - see 5.3.**
- **Per-wallet thresholds in USD** (currently global settings): extend `Wallet` with an optional threshold.
- **Price data:** add a price source with caching, so USD values stop being stale when a provider fails. **Partly built: the CoinGecko price table is cached for 30 seconds and the last good table is kept for six hours.**
- **Audit log:** an append-only table of security-relevant events (login, password reset, wallet added or removed).
- **Two-factor authentication** (TOTP) for accounts once there are paying users.

### 6.4 Business and scale
- **Billing:** Stripe subscriptions gating wallet count and notification channels. Store plan limits in code, not only in the UI.
- **Commercial hosting:** Render Starter web service plus a paid Postgres plan as the baseline. Re-evaluate at roughly 500 active users.
- **Background worker:** move `monitorAll()` out of the request path into a dedicated worker process, once a single run starts exceeding the request timeout.
- **Native apps:** if an App Store or Play Store listing is wanted, build an Expo client against the same authenticated API. Do not duplicate business logic in the client.
- **Multi-tenant teams:** shared vaults with roles, only after the single-user model is stable.

### 6.5 Email deliverability roadmap
1. Now: Resend with `onboarding@resend.dev`, testing only.
2. When inviting outside users: buy a domain, verify it in Resend, set `EMAIL_FROM`, add SPF, DKIM, and DMARC records.
3. If Resend becomes a constraint: SMTP2GO HTTPS API as an alternate provider behind the same `sendMail()` interface. Requires a code change in `lib/mail.js`.
4. Self-hosted Postfix: not recommended on free infrastructure. Requires a VPS that permits port 25, a domain, reverse DNS, and ongoing reputation management.

---

## 7. Definition of done for any change

- [ ] Code compiles (syntax check every changed file).
- [ ] No secrets added to source, logs, or documentation.
- [ ] Failure paths log a reason and do not stop other wallets or users.
- [ ] New env vars are added to this document, `render.yaml`, and `.env.example`.
- [ ] Layout checked at 320px and 1280px.
- [ ] Behaviour verified against a real service, or explicitly marked untested in the handover note.
- [ ] Failsafes in section 5 still apply.

---

## 8. Handover note template

When you finish a change, report:

1. What changed, by file.
2. What was run and what was not. Be explicit.
3. Any new environment variable, GitHub secret, or manual step the owner must take.
4. Any failsafe affected, and whether it still works.

---

## Changelog

### 2026-10-17 - Monitoring reliability pass

- Notification rows are now written even when the recipient is not verified or the
  price is unknown; only the email is skipped, and the reason is stored.
- Alerts that never reached the inbox are retried by the monitor job
  (`Notification.emailStatus` and friends).
- A withdrawal alert needs a second confirming read; a recovered balance
  produces nothing.
- Every chain got an ordered list of RPC endpoints; the Bitcoin address API got
  a second provider.
- Prices, token balances and transaction activity are cached, so the dashboard
  no longer spends the free tier quota of the public providers on every poll.
- Logs no longer contain full addresses or full email addresses.
- The browser no longer receives the list of RPC endpoints.
- New: `lib/alerts.mjs`, `lib/cache.mjs`, `lib/log.mjs`, `lib/prices.mjs`,
  `tests/`, `scripts/syntax-check.mjs`, and `npm test` / `npm run check`.
