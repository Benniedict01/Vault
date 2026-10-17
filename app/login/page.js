'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        setError(
          authError.status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : authError.message || 'Incorrect email or password.'
        );
        setLoading(false);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Unable to contact the server.');
      setLoading(false);
    }
  }

  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Welcome back</h1>
    <p>Sign in to your private wallet vault. Email verification is not required to sign in, but it is required before email alerts are sent.</p>
    <form onSubmit={submit}>
      <div className="field"><label>Email</label><input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></div>
      <div className="field"><label>Password</label><input type="password" value={password} onChange={event => setPassword(event.target.value)} required /></div>
      {error && <div className="err">{error}</div>}
      <button className="btn primary full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in →'}</button>
    </form>
    <p><Link href="/forgot-password">Forgot password?</Link></p>
    <p><Link href="/resend-verification">Resend verification email</Link></p>
    <p className="muted" style={{ fontSize: 13 }}>Verification and reset emails can take a minute. If nothing arrives, check your spam folder.</p>
    <p style={{ textAlign: 'center' }}>New here? <Link href="/signup">Create an account</Link></p>
  </div></main>;
}
