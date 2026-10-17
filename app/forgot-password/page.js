'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPassword() {
  const [e, setE] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function go(event) {
    event.preventDefault();
    setLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e }),
      });
      const j = await r.json().catch(() => ({}));
      // Always generic — the server never reveals whether the account exists.
      setMsg(j.message || "If an account exists for that email, you'll receive a password reset email.");
    } catch {
      setErr('Unable to contact the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth"><div className="authbox">
      <Link href="/" className="brand">Crypto<span>Vault</span></Link>
      <h1>Reset password</h1>
      <p>Enter your account email and we’ll send a reset link if an account exists.</p>
      <form onSubmit={go}>
        <div className="field">
          <label>Email</label>
          <input type="email" value={e} onChange={(x) => setE(x.target.value)} required autoComplete="email" />
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn primary full" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
      </form>
      {msg && <div className="success">{msg}</div>}
      <p><Link href="/login">Back to sign in</Link></p>
    </div></main>
  );
}
