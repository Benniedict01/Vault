'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function VerifyEmail() {
  const [state, setState] = useState('verifying'); // verifying | ok | error | missing
  const [message, setMessage] = useState('');
  const [resend, setResend] = useState('');
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) {
      setState('missing');
      setMessage('This verification link is incomplete. Request a new one below.');
      return;
    }
    fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setState('ok');
          setMessage('Email verified. Your vault is ready.');
        } else {
          setState('error');
          setMessage(j.error || 'This verification link is invalid or expired.');
        }
      })
      .catch(() => {
        setState('error');
        setMessage('We couldn’t reach the server. Please try again.');
      });
  }, []);

  return (
    <main className="auth"><div className="authbox">
      <Link href="/" className="brand">Crypto<span>Vault</span></Link>
      <h1>Email verification</h1>
      {state === 'verifying' && <p role="status">Verifying your email…</p>}
      {state !== 'verifying' && <p>{message}</p>}
      {state === 'ok' && (
        <Link className="btn primary full" href="/dashboard">Open your vault</Link>
      )}
      {(state === 'error' || state === 'missing') && (
        <>
          <Link className="btn primary full" href="/resend-verification">Send a new verification email</Link>
          <p style={{ marginTop: 16 }}><Link href="/login">Back to sign in</Link></p>
        </>
      )}
    </div></main>
  );
}
