import './globals.css';
import { Space_Grotesk, DM_Sans, JetBrains_Mono } from 'next/font/google';
import PWA from './pwa';

// Self-hosted at build time by Next.js — no runtime request to Google Fonts.
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = DM_Sans({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

function siteUrl() {
  try { return new URL(process.env.APP_URL || 'http://localhost:3000'); }
  catch { return new URL('http://localhost:3000'); }
}

const title = 'Crypto Vault — Never miss a deposit';
const description = 'A private, watch-only vault for your public wallet addresses. Get alerted when funds arrive. No seed phrases, no private keys.';

export const metadata = {
  metadataBase: siteUrl(),
  title,
  description,
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Crypto Vault', statusBarStyle: 'black-translucent' },
  openGraph: { title, description, type: 'website', siteName: 'Crypto Vault' },
  twitter: { card: 'summary', title, description },
};
export const viewport = { themeColor: '#06080c', viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}<PWA /></body>
    </html>
  );
}
