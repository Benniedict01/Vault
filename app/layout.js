import './globals.css';
import PWA from './pwa';

export const metadata = {
  title: 'Crypto Vault — Never miss a deposit',
  description: 'A private, watch-only crypto wallet monitoring vault.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Crypto Vault', statusBarStyle: 'black-translucent' },
};
export const viewport = { themeColor: '#07090d', viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}<PWA /></body></html>;
}
