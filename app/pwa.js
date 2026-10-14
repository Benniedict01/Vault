'use client';
import { useEffect, useState } from 'react';

// Registers the service worker and shows a small "Install app" pill:
//  - Android/Chrome/Edge: uses the browser's install prompt.
//  - iPhone/iPad Safari: no install prompt exists, so show the Add to Home Screen hint.
export default function PWA() {
  const [deferred, setDeferred] = useState(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (standalone || localStorage.getItem('cv-install-dismissed')) return;

    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    if (isIOS) { setIosHint(true); setHidden(false); }

    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); setHidden(false); };
    const onInstalled = () => { setHidden(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() { localStorage.setItem('cv-install-dismissed', '1'); setHidden(true); }
  async function install() {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null); setHidden(true);
  }
  if (hidden) return null;

  const box = { position: 'fixed', left: 12, right: 12, bottom: 'max(12px, env(safe-area-inset-bottom))', zIndex: 50, maxWidth: 440, margin: '0 auto',
    background: '#111722', color: '#f5f7fb', border: '1px solid #202936', borderRadius: 16, padding: '12px 14px',
    display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 10px 30px rgba(0,0,0,.45)', fontSize: 14, lineHeight: 1.4 };
  const btn = { background: '#62f2a3', color: '#07090d', border: 0, borderRadius: 10, padding: '9px 14px', fontWeight: 700, fontSize: 14 };
  const x = { background: 'none', border: 0, color: '#8b96a8', fontSize: 22, lineHeight: 1, padding: 4 };

  return (
    <div style={box} role="dialog" aria-label="Install Crypto Vault">
      <div style={{ flex: 1 }}>
        {iosHint && !deferred
          ? <>Install Crypto Vault: tap <b>Share</b>, then <b>Add to Home Screen</b>.</>
          : <>Install Crypto Vault as an app on this device.</>}
      </div>
      {deferred && <button style={btn} onClick={install}>Install</button>}
      <button style={x} onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}
