import './globals.css';
import localFont from 'next/font/local';
import PWA from './pwa';

// Self-hosted variable fonts (OFL-licensed, via @fontsource-variable). No
// runtime or build-time request to Google Fonts — the build never depends on
// an external font host.
const display = localFont({
  src: './fonts/space-grotesk-latin-wght-normal.woff2',
  weight: '300 700',
  variable: '--font-display',
  display: 'swap',
});
const body = localFont({
  src: './fonts/dm-sans-latin-wght-normal.woff2',
  weight: '100 1000',
  variable: '--font-body',
  display: 'swap',
});
const mono = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-mono',
  display: 'swap',
});

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
