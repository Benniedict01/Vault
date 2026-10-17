'use client';
import { useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      // The response is always the same whether or not the address has an
      // account, so this page cannot be used to discover accounts.
      const { error: authError } = await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      });
      if (authError && authError.status === 429) {
        setError('Too many requests. Wait a minute and try again.');
      } else {
        setMessage('If that email has an account, a password reset link has been sent. The link expires in 1 hour.');
      }
    } catch {
      setError('Unable to contact the server.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Reset password</h1>
    <p>Enter your account email and we’ll send a reset link.</p>
    <form onSubmit={submit}>
      <div className="field"><label>Email</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
      {error && <div className="err">{error}</div>}
      <button className="btn primary full" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'}</button>
    </form>
    {message && <div className="success">{message}</div>}
    <p><Link href="/login">Back to sign in</Link></p>
  </div></main>;
}
