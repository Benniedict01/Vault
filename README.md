# Crypto Vault

A privacy-first, multi-user, watch-only crypto wallet monitoring SaaS.

> **Read [`ENGINEERING.md`](./ENGINEERING.md) before changing anything.** It is
> the standing brief: non-negotiable principles, the environment contract,
> failsafes, and the handover-note template. It wins over a quick request until
> it is updated.

## Product model
- Users sign up with email/password. Accounts, sessions, email verification and password resets are handled by [Better Auth](https://better-auth.com), not by hand-written routes.
- Each user owns a private vault of public wallet addresses.
- Supports Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis, Linea, Scroll, zkSync, Mantle, Celo, Cronos, opBNB, Moonbeam, Moonriver, Metis, Blast, Mode, Taiko, Sei EVM, Berachain, Ink, Sonic, Solana and Bitcoin.
- Deposit detection is based on native balance increases.
- Withdrawals need two consecutive readings below the last confirmed balance before an alert is sent, so a provider that briefly reports zero cannot raise a false alarm.
- Alerts are stored first and emailed second; anything that could not be emailed is retried by a later monitoring run.
- Email alerts are sent to the account email.
- Seed phrases/private keys are rejected and never stored.

## Deploying (Render + GitHub Actions + Plunk)

1. **Database** - Render PostgreSQL. Copy the *Internal Database URL* into `DATABASE_URL` on the web service. The build runs `npx prisma db push` (adds tables and columns without dropping data) and then `node scripts/migrate-auth.mjs`, which is idempotent. Note: Render's free Postgres is time-limited (check the expiry date on its page) - move to a paid plan or export data before it lapses.
2. **Web service** - set `DATABASE_URL`, `AUTH_SECRET` (32+ chars), `APP_URL` (exact Render URL, no trailing slash), `CRON_SECRET`, `PLUNK_SECRET_KEY`, and optionally `PLUNK_FROM`.
3. **Email (Plunk)** - create an account at [useplunk.com](https://useplunk.com), verify a sender address or domain in the project, then copy the secret key into `PLUNK_SECRET_KEY`. Set `PLUNK_FROM` to `Crypto Vault <alerts@your-domain.com>` (or leave it empty to use the project default sender). Verification, password-reset and balance alerts all go through `lib/mail.js`, which calls the Plunk HTTPS API.
4. **Monitoring** - `.github/workflows/monitor.yml` calls `/api/monitor` every 5 minutes. In the GitHub repo add Actions secrets `VAULT_APP_URL` (your Render URL) and `VAULT_CRON_SECRET` (same value as `CRON_SECRET`). Then run the workflow once manually from the Actions tab to confirm it succeeds. The pings also keep a free-plan service awake. Scheduled workflows on public repos are paused after 60 days without repo activity.
5. There is no SMTP path. If `PLUNK_SECRET_KEY` is empty, sends fail fast with a logged "not configured" error; verification and reset screens show a generic message and the alert row is still stored for retry.

## Install as an app (PWA)

The site is an installable web app: no app store, works on iPhone and Android.
- **Android / Chrome / Edge:** tap *Install* on the in-app banner, or browser menu -> *Install app*.
- **iPhone / iPad:** open the site in **Safari** -> Share -> **Add to Home Screen**.
The service worker only caches an offline page and icons. It never caches API responses or signed-in pages.

## Security
This is deliberately watch-only. Never add a private key, seed phrase, recovery phrase, or wallet password. Public wallet addresses are not credentials.


## Email delivery and wallet verification rules

- Accounts, sessions, email verification and password resets are handled by Better Auth (`lib/auth.js`). Do not add hand-written routes under `/api/auth/*`: the catch-all route owns that segment.
- Verification and reset tokens are single use and expire (24 hours and 1 hour). They are stored as SHA-256 hashes in the `Verification` table; the raw token exists only in the emailed link.
- The first wallet may be added before email verification. A user must verify their email before adding a second or subsequent wallet, and alerts are only emailed to a verified address.
- Passwords remain bcrypt. Better Auth is configured with a custom hash/verify so accounts created before the migration keep working.
- Resetting a password signs out every other session.
- Delivery errors are logged with status and reason only. Credentials and message bodies are never logged, and the client always gets a generic message.
- Plunk is the only sender. If mail is not configured, the app still works; only the emails fail.

## Custom domain

A `*.onrender.com` address cannot be used as an email sending domain, because you do not control its DNS. Buy a domain, then:
1. In Plunk, add the domain, add the DNS records it shows at your registrar (SPF, DKIM, DMARC), and wait for verification.
2. Set `PLUNK_FROM` to an address on it, for example `Crypto Vault <alerts@yourdomain.com>`.
3. In Render, add `app.yourdomain.com` under Settings, Custom Domains, create the CNAME it asks for, then set `APP_URL` to the new address.
