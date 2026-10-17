import Link from 'next/link';

// Verification links point at /api/auth/verify-email, which Better Auth handles
// and then redirects to the sign-in page. This route exists for people who land
// here directly (an old link, a bookmark, or a typo) so they get an explanation
// instead of a 404.
export const metadata = { title: 'Email verification — Crypto Vault' };

export default function Verify() {
  return <main className="auth"><div className="authbox">
    <Link href="/" className="brand">Crypto<span>Vault</span></Link>
    <h1>Email verification</h1>
    <p>Verification finishes automatically when you open the link in your inbox. There is no code to type.</p>
    <p>If the link has expired or you never received it, request a new one:</p>
    <Link className="btn primary full" href="/resend-verification">Send a new verification link</Link>
    <p style={{ textAlign: 'center' }}><Link href="/login">Back to sign in</Link></p>
  </div></main>;
}
