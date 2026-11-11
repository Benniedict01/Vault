'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function Signup() {
  const [e, setE] = useState('');
  const [p, setP] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setMsg('');
    setErr('');
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e, password: p })
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error);
      else setMsg(j.message);
    } catch {
      setErr('Unable to contact the server.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Create your vault</h1>
    <p>Watch-only wallet monitoring. Private keys and seed phrases are never accepted.</p>
    {msg ? <div className="success">{msg}<p style={{ marginBottom: 0 }}>You can sign in now. Email verification is required before Crypto Vault sends wallet alerts to this address.</p></div> : <form onSubmit={submit}>
      <div className="field"><label>Email</label><input type="email" value={e} onChange={event => setE(event.target.value)} required /></div>
      <div className="field"><label>Password</label><input type="password" value={p} onChange={event => setP(event.target.value)} minLength={8} required /></div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary full" disabled={loading}>{loading ? 'Creating…' : 'Create vault →'}</button>
    </form>}
    <p style={{ textAlign: 'center' }}>Already have an account? <Link href="/login">Sign in</Link></p>
  </div></main>;
}
