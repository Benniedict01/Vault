'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

export default function Reset() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Read the token from the address bar in the browser: the reset link is
  // /reset-password?token=… after Better Auth redirects here.
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
  }, []);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { error: authError } = await authClient.resetPassword({ newPassword: password, token });
      if (authError) {
        setError(authError.message || 'This reset link is invalid or expired.');
      } else {
        setMessage('Password changed. Every other signed-in device has been signed out.');
        setPassword('');
      }
    } catch {
      setError('Unable to contact the server.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Choose a new password</h1>
    {!token && <div className="err">This page needs a reset link. Open the link from your email, or <Link href="/forgot-password">request a new one</Link>.</div>}
    <form onSubmit={submit}>
      <div className="field"><label>New password</label><input type="password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required disabled={!token} /></div>
      {error && <div className="err">{error}</div>}
      {message && <div className="success">{message}</div>}
      <button className="btn primary full" disabled={loading || !token}>{loading ? 'Updating…' : 'Update password'}</button>
    </form>
    <p><Link href="/login">Back to sign in</Link></p>
  </div></main>;
}
