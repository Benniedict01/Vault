# Crypto Vault

A privacy-first, multi-user, watch-only crypto wallet monitoring SaaS.

## Product model
- Users sign up with email/password.
- Each user owns a private vault of public wallet addresses.
- Supports Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Gnosis, Linea, Scroll, zkSync, Mantle, Celo, Cronos, opBNB, Moonbeam, Moonriver, Metis, Blast, Mode, Taiko, Sei EVM, Berachain, Ink, Sonic, Solana and Bitcoin.
- Deposit detection is based on native balance increases.
- Email alerts are sent to the account email.
- Seed phrases/private keys are rejected and never stored.

## Deploying (Render + GitHub Actions + Resend)

1. **Database** - Render PostgreSQL. Copy the *Internal Database URL* into `DATABASE_URL` on the web service. Note: Render's free Postgres is time-limited (check the expiry date on its page) - move to a paid plan or export data before it lapses.
2. **Web service** - set `DATABASE_URL`, `AUTH_SECRET` (32+ chars), `APP_URL` (exact Render URL, no trailing slash), `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`.
3. **Email (Resend)** - create an API key at resend.com. To email *any* user you must verify a sending domain in Resend and use an address on it for `EMAIL_FROM`. Without a verified domain, Resend only delivers to your own account email (use `Crypto Vault <onboarding@resend.dev>` for testing).
4. **Monitoring** - `.github/workflows/monitor.yml` calls `/api/monitor` every 5 minutes. In the GitHub repo add Actions secrets `VAULT_APP_URL` (your Render URL) and `VAULT_CRON_SECRET` (same value as `CRON_SECRET`). Then run the workflow once manually from the Actions tab to confirm it succeeds. The pings also keep a free-plan service awake. Scheduled workflows on public repos are paused after 60 days without repo activity.
5. If `RESEND_API_KEY` is empty the app falls back to SMTP (`SMTP_*`), which only works on plans that allow outbound SMTP - Render's free plan blocks it.

## Install as an app (PWA)

The site is an installable web app: no app store, works on iPhone and Android.
- **Android / Chrome / Edge:** tap *Install* on the in-app banner, or browser menu -> *Install app*.
- **iPhone / iPad:** open the site in **Safari** -> Share -> **Add to Home Screen**.
The service worker only caches an offline page and icons. It never caches API responses or signed-in pages.

## Security
This is deliberately watch-only. Never add a private key, seed phrase, recovery phrase, or wallet password. Public wallet addresses are not credentials.


## Email delivery and wallet verification rules

- `SMTP_USER` is the sending mailbox used by the server; it is not the recipient for every notification.
- Verification and password-reset messages are sent to the email address entered by each user. Deposit/withdrawal notifications are sent to that same user's registered email, provided it has been verified and their notification settings allow the message.
- The first wallet may be added before email verification. A user must verify their email before adding a second or subsequent wallet.
- For Gmail SMTP, use `smtp.gmail.com`, port `465` (SSL) or `587` (STARTTLS), the full Gmail address as `SMTP_USER`, and a Google App Password as `SMTP_PASSWORD` (not the normal Google password). Set `SMTP_FROM` to that same Gmail address while testing and set `APP_URL` to the exact deployed Render URL.
- SMTP errors are logged with diagnostic codes only; credentials and message bodies are not logged. Check Render logs after requesting a verification email.
- Production requires a strong `AUTH_SECRET` of at least 32 characters.
