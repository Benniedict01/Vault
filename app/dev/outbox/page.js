import fs from 'node:fs';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';

// Local preview only. `npm run preview` writes every outgoing email to
// .preview/outbox.jsonl instead of sending it, because there is no Plunk key and
// no inbox in a development environment. This page shows them so the
// verification and reset links can actually be clicked.
//
// It does nothing unless VAULT_PREVIEW_OUTBOX is set, which the preview script
// sets and the deployed app never does, so it is a 404 in production.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Preview inbox — Crypto Vault' };

const MAX_SHOWN = 25;

function readOutbox(file) {
  if (!file || !fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const messages = [];
  for (const line of lines.slice(-200)) {
    try { messages.push(JSON.parse(line)); } catch { /* a torn last line: ignore */ }
  }
  return messages.reverse();
}

// Better Auth builds links from APP_URL (http://localhost:3000). The preview is
// opened through a proxied host, so rewrite them to wherever this page is being
// viewed from. The path and token are untouched.
async function currentOrigin() {
  const list = await headers();
  const host = list.get('x-forwarded-host') || list.get('host');
  const proto = list.get('x-forwarded-proto') || 'http';
  return host ? `${proto}://${host}` : '';
}

function rewriteLinks(text, appUrl, origin) {
  if (!appUrl || !origin || appUrl === origin) return text;
  return text.split(appUrl).join(origin);
}

export default async function Outbox() {
  const file = process.env.VAULT_PREVIEW_OUTBOX;
  // Not configured: this route does not exist as far as the deployed app is
  // concerned.
  if (!file) notFound();

  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const origin = await currentOrigin();
  const messages = readOutbox(file);

  return (
    <main className="auth"><div className="authbox">
      <Link href="/" className="brand">Crypto<span>Vault</span></Link>
      <h1>Preview inbox</h1>
      <p className="muted">
        Emails the app would have sent. Nothing left this machine: with no
        <code> PLUNK_SECRET_KEY </code>
        the sender writes here instead. Links are rewritten to this address so
        they work when you click them.
      </p>

      {messages.length === 0 && <p className="empty">No email yet. Sign up, or ask for a password reset.</p>}

      <div className="lists">
        {messages.slice(0, MAX_SHOWN).map((message, index) => {
          const body = rewriteLinks(message.text || '', appUrl, origin);
          return (
            <article className="card" key={`${message.at}-${index}`}>
              <p className="eyebrow">{message.at?.replace('T', ' ').slice(0, 16)} · to {message.to}</p>
              <h3>{message.subject}</h3>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', margin: 0 }}>
                {body}
              </pre>
            </article>
          );
        })}
      </div>

      <form action="/dev/outbox/clear" method="post">
        <button className="btn full" type="submit">Clear the inbox</button>
      </form>
      <p style={{ textAlign: 'center' }}><Link href="/login">Back to sign in</Link></p>
    </div></main>
  );
}
