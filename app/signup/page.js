'use client';
import { useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');
    try {
      // Better Auth requires a name. The product does not collect one, so the
      // local part of the address is used and can be changed later.
      const name = email.split('@')[0].slice(0, 60) || 'Crypto Vault user';
      const { error: authError } = await authClient.signUp.email({ email, password, name });

      if (authError) {
        // With autoSignIn disabled, Better Auth answers duplicate sign-ups with
        // the same generic success, so this really is a validation error.
        setError(authError.message || 'Unable to create account.');
      } else {
        setMessage('Account created. Check your email for the verification link. You can sign in now; verification is needed before alerts are sent.');
      }
    } catch {
      setError('Unable to contact the server.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Create your vault</h1>
    <p>Watch-only wallet monitoring. Private keys and seed phrases are never accepted.</p>
    {message ? <div className="success">
      {message}
      <p style={{ marginBottom: 0 }}>No email after a few minutes? Check your spam folder, or <Link href="/resend-verification">request a new link</Link>.</p>
    </div> : <form onSubmit={submit}>
      <div className="field"><label>Email</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
      <div className="field"><label>Password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required /></div>
      {error && <div className="err">{error}</div>}
      <button className="btn primary full" disabled={loading}>{loading ? 'Creating…' : 'Create vault →'}</button>
    </form>}
    <p style={{ textAlign: 'center' }}>Already have an account? <Link href="/login">Sign in</Link></p>
  </div></main>;
}
