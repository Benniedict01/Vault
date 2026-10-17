'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function ResetPassword() {
  const [token, setToken] = useState('');
  const [p, setP] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [missingToken, setMissingToken] = useState(false);
  const r = useRouter();

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') || '';
    setToken(t);
    if (!t) setMissingToken(true);
  }, []);

  async function go(e) {
    e.preventDefault();
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: p }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || 'This reset link is invalid or expired.');
        setLoading(false);
        return;
      }
      setMsg('Password changed. You can now sign in.');
      setTimeout(() => r.push('/login'), 1500);
    } catch {
      setErr('Unable to contact the server. Please try again.');
      setLoading(false);
    }
  }

  return (
    <main className="auth"><div className="authbox">
      <Link href="/" className="brand">Crypto<span>Vault</span></Link>
      <h1>Choose a new password</h1>
      {missingToken ? (
        <>
          <p>This reset link is incomplete. Request a new one.</p>
          <Link className="btn primary full" href="/forgot-password">Request a new reset link</Link>
          <p style={{ marginTop: 16 }}><Link href="/login">Back to sign in</Link></p>
        </>
      ) : (
        <>
          <p>Set a new password for your vault. This link works once.</p>
          <form onSubmit={go}>
            <div className="field">
              <label>New password</label>
              <input
                type="password" minLength={8} value={p}
                onChange={(e) => setP(e.target.value)} required
                autoComplete="new-password"
              />
            </div>
            {err && <div className="err">{err}</div>}
            {msg && <div className="success">{msg}</div>}
            <button className="btn primary full" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
          <p style={{ marginTop: 16 }}><Link href="/login">Back to sign in</Link></p>
        </>
      )}
    </div></main>
  );
}
