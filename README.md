# Crypto Vault

A privacy-first, multi-user, watch-only crypto wallet monitoring SaaS.
"Your private command center for watching your crypto wallets." Public addresses only — never seed phrases or private keys.

## Product model
- Users sign up with email/password and verify their email.
- Each user owns a private vault of public wallet addresses.
- Supports Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis, Linea, Scroll, zkSync, Mantle, Celo, Cronos, opBNB, Moonbeam, Moonriver, Metis, Blast, Mode, Taiko, Sei EVM, Berachain, Ink, Sonic, Solana and Bitcoin.
- Balances and current market prices are combined server-side into per-wallet, per-asset and total USD values. When a price cannot be fetched the UI shows **"Price unavailable"** — never `$0.00`.
- Deposit detection compares observed balances and scans token transfers; every detected event is claimed in an idempotency ledger (`ProcessedEvent`) so re-runs never duplicate alerts.
- Email alerts are sent to the account email of the wallet's owner.
- Seed phrases/private keys are rejected and never stored.

## Architecture

```
app/api/*            route handlers (thin) — auth, wallets, portfolio, activity, monitor, settings
lib/
  email/             EmailService -> provider adapter -> Resend (HTTPS). Errors are
                     typed (EMAIL_NOT_CONFIGURED, EMAIL_PROVIDER_ERROR, ...); every
                     send is recorded in the EmailEvent table.
  chains/            ChainService -> EVM / Solana / Bitcoin adapters
                     (validateAddress, getNativeBalance, getTokenBalances,
                      detectIncomingTransfers, getTransactions)
  pricing/           PriceService -> CoinGecko (primary) -> CryptoCompare (fallback)
                     -> TTL cache. Missing prices are null, never 0.
  wallets/policy.js  wallet-limit rules (1st wallet unverified OK, 2nd needs a
                     verified email; future plans extend one function)
  security/          in-memory rate limiter for auth + wallet + monitor routes
  monitoring         monitor engine (idempotent, per-wallet failure isolation)
prisma/              User, Wallet, Notification, EmailEvent, ProcessedEvent
```

## Environment variables

See `.env.example` for the full contract. Required in production:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | 32+ char random secret for session JWTs |
| `APP_URL` | Exact deployed URL (used in email links) |
| `RESEND_API_KEY` | Resend HTTPS API key (server-side only) |
| `EMAIL_FROM` | Sender on a Resend-verified domain |
| `CRON_SECRET` | Bearer secret for the scheduled monitor job |

Optional: `EMAIL_PROVIDER` / `EMAIL_PROVIDER_FALLBACK` (future provider failover), `PRICE_CACHE_TTL_SECONDS` (default 30).

## Email delivery

Transactional email goes through a central `EmailService` and a provider
adapter — the app never talks to an SMTP server (Render's free plan blocks
outbound SMTP, and SMTP is not used as a transport here). Today the chain is:

```
Application -> EmailService -> ResendAdapter -> Resend HTTPS API
```

Adding Brevo / Mailjet / SES / Postmark later = one adapter module +
registration in `lib/email/providers/index.js`; auth and notification code do
not change. Failures are logged with structured diagnostics (never tokens,
passwords or API keys) and recorded in the `EmailEvent` table; users see only a
friendly message. Verification and reset links use `APP_URL` and expire
(24h / 1h) and are single-use.

**Resend setup:** create an API key at resend.com. To email *any* user you must
verify a sending domain in Resend and use an address on it for `EMAIL_FROM`.
Without a verified domain, Resend only delivers to your own account email
(testing only: `Crypto Vault <onboarding@resend.dev>`).

## Deploying (Render + GitHub Actions + Resend)

1. **Database** — Render PostgreSQL. Copy the connection string into `DATABASE_URL` on the web service. Note: Render's free Postgres is time-limited — move to a paid plan or export data before it lapses.
2. **Web service** — set `DATABASE_URL`, `AUTH_SECRET` (32+ chars), `APP_URL` (exact Render URL, no trailing slash), `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`. The build command in `render.yaml` runs `prisma db push`, which only applies additive schema changes (it never drops tables or resets data).
3. **Monitoring** — `.github/workflows/monitor.yml` calls `/api/monitor` every 5 minutes with `Authorization: Bearer CRON_SECRET`. Add GitHub Actions secrets `VAULT_APP_URL` (your Render URL) and `VAULT_CRON_SECRET` (same value as `CRON_SECRET`), then run the workflow once from the Actions tab to confirm it succeeds. The pings also keep a free-plan service awake. Scheduled workflows on public repos are paused after 60 days without repo activity — any external scheduler (Render Cron, cron-job.org, GitHub Actions) works, or trigger `POST /api/monitor` manually from the dashboard's "Refresh now".
4. **Custom domain (recommended)** — a `*.onrender.com` address cannot be an email sending domain. In Resend, add your domain (or e.g. `mail.yourdomain.com`), add the DNS records at your registrar, verify it, then set `EMAIL_FROM` to an address on it. In Render add the custom domain and set `APP_URL` to it.

## Monitoring & notification rules

- The first wallet may be added before email verification. A user must verify their email before adding a second wallet — enforced **server-side** (`lib/wallets/policy.js`), with a "Resend verification email" action in the UI.
- Deposit/withdrawal/token-deposit notifications go to that user's own registered email (never a shared admin address) and only when the address is verified.
- `Minimum notification (USD)` of `0` means no threshold: dust still notifies. A missing market price never suppresses a real deposit.
- Duplicate protection: deterministic event keys + unique constraint mean running the monitor twice (or overlapping cron runs) sends one notification per on-chain event.
- A failing RPC/endpoint is retried once with backoff, marked degraded, and monitoring continues for every other wallet.

## Install as an app (PWA)

The site is an installable web app: no app store, works on iPhone and Android.
- **Android / Chrome / Edge:** tap *Install* on the in-app banner, or browser menu -> *Install app*.
- **iPhone / iPad:** open the site in **Safari** -> Share -> **Add to Home Screen**.
The service worker only caches an offline page and icons. It never caches API responses or signed-in pages.

## Security

- Watch-only by design: anything that looks like a seed phrase or private key is rejected before storage or external calls.
- Passwords hashed with bcrypt (cost 12). Sessions are signed JWTs in `HttpOnly` + `Secure` + `SameSite=Lax` cookies. `AUTH_SECRET` and `CRON_SECRET` come only from environment variables.
- Every wallet query is scoped to the server-side session user; browser-supplied user ids are never trusted.
- Rate limiting on login, signup, verification resend, forgot-password, password reset, wallet creation and monitor endpoints.
- Account-enumeration protection on forgot-password and resend-verification (generic responses).
- Email logging redacts recipients and never logs passwords, API keys, or verification/reset tokens.

## Local development

```bash
cp .env.example .env   # fill in values
npm install            # runs prisma generate
npx prisma db push     # apply schema to your dev database
npm run dev
```
