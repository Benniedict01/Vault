'use client';
import { useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

export default function ResendVerification() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const { error: authError } = await authClient.sendVerificationEmail({
        email,
        callbackURL: '/login',
      });
      if (authError && authError.status === 429) {
        setError('Too many requests. Wait a minute and try again.');
      } else if (authError) {
        setError(authError.message || 'Unable to send verification email.');
      } else {
        // Same wording whether or not the address exists.
        setMessage('If the account needs verification, a new link is on its way. Check your spam folder if it does not arrive.');
      }
    } catch {
      setError('Unable to contact the server.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Verify your email</h1>
    <p>Enter your account email and we’ll send a fresh verification link. The link expires in 24 hours.</p>
    <form onSubmit={submit}>
      <div className="field"><label>Email</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
      {error && <div className="err">{error}</div>}
      {message && <div className="success">{message}</div>}
      <button className="btn primary full" disabled={loading}>{loading ? 'Sending…' : 'Send verification email'}</button>
    </form>
    <p><Link href="/login">Back to sign in</Link></p>
  </div></main>;
}
