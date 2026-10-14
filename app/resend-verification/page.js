'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function ResendVerification() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setMsg('');
    setErr('');
    try {
      const r = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || 'Unable to send verification email.');
      else setMsg(j.message);
    } catch {
      setErr('Unable to contact the server.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Verify your email</h1>
    <p>Enter your account email and we’ll send a fresh verification link.</p>
    <form onSubmit={submit}>
      <div className="field"><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
      {err && <div className="err">{err}</div>}
      {msg && <div className="success">{msg}</div>}
      <button className="btn primary full" disabled={loading}>{loading ? 'Sending…' : 'Send verification email'}</button>
    </form>
    <p><Link href="/login">Back to sign in</Link></p>
  </div></main>;
}
