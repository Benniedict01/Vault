'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 8 });
const usd = (n) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function timeAgo(date, now) {
  if (!date) return 'Not checked yet';
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 5) return 'Updated just now';
  if (s < 60) return `Updated ${s} seconds ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `Updated ${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return `Updated ${h} hour${h === 1 ? '' : 's'} ago`;
}

function shortAddress(addr) {
  if (!addr || addr.length < 16) return addr || '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [activity, setActivity] = useState([]);
  const [settings, setSettings] = useState(null);
  const [modal, setModal] = useState(false);
  const [label, setLabel] = useState('');
  const [chain, setChain] = useState('ethereum');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [verifyAction, setVerifyAction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | live | updating | error
  const [lastUpdated, setLastUpdated] = useState(null);
  const [banner, setBanner] = useState('');
  const [resendState, setResendState] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(true);
  const hasData = useRef(false);

  // Ticking clock for "Updated N seconds ago" labels.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!mounted.current) return;
    if (!silent) setStatus((s) => (s === 'loading' ? 'loading' : 'updating'));
    try {
      const [a, b, c, d] = await Promise.all([
        fetch('/api/wallets'),
        fetch('/api/portfolio'),
        fetch('/api/activity'),
        fetch('/api/settings'),
      ]);
      if (a.status === 401) { router.push('/login'); return; }
      if (!a.ok || !b.ok || !d.ok) throw new Error('load failed');

      const walletsJson = await a.json();
      const portfolioJson = await b.json();
      const activityJson = c.ok ? await c.json() : [];
      const settingsJson = await d.json();

      if (!mounted.current) return;
      setData(walletsJson);
      setPortfolio(portfolioJson);
      setActivity(activityJson);
      setSettings(settingsJson);
      setLastUpdated(new Date());
      setStatus('live');
      setBanner('');
      hasData.current = true;
    } catch {
      if (!mounted.current) return;
      setStatus('error');
      setBanner(hasData.current
        ? 'Unable to update right now — showing the last loaded data.'
        : 'Data temporarily unavailable. Please check your connection and retry.');
    }
  }, [router]);

  // Auto-refresh while visible; pause when the tab is hidden or the user is
  // away. On focus, refresh immediately so returning users see fresh data.
  useEffect(() => {
    mounted.current = true;
    load();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) load(true);
    }, 15000);
    const onVisible = () => { if (!document.hidden) load(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  async function refreshNow() {
    setStatus('updating');
    try {
      await fetch('/api/monitor', { method: 'POST' }); // re-check balances too
    } catch { /* monitor failure is surfaced by the reload below */ }
    await load();
  }

  async function monitor() {
    await fetch('/api/monitor', { method: 'POST' });
    await load();
  }

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setVerifyAction(false);
    try {
      const r = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label, chain, address }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error || 'Unable to add wallet.');
        setVerifyAction(j.code === 'EMAIL_VERIFICATION_REQUIRED');
      } else {
        setModal(false);
        setLabel('');
        setAddress('');
        await monitor();
      }
    } catch {
      setError('Unable to contact the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!confirm('Remove this wallet from your vault?')) return;
    await fetch('/api/wallets?id=' + encodeURIComponent(id), { method: 'DELETE' });
    load();
  }

  async function updateSetting(k, v) {
    const r = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [k]: v }),
    });
    if (r.ok) {
      setSettings(await r.json());
      if (k === 'tokenMonitoringEnabled') load();
    }
  }

  async function resendVerification() {
    setResendState('sending');
    try {
      const r = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: settings?.email }),
      });
      const j = await r.json().catch(() => ({}));
      setResendState(r.ok ? 'sent' : 'failed');
      if (!r.ok && j.error) setError(j.error);
    } catch {
      setResendState('failed');
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }

  if (!data || !portfolio || !settings) {
    return (
      <main className="auth">
        <div className="muted" role="status">
          {status === 'error' ? 'Data temporarily unavailable. Please refresh the page.' : 'Updating portfolio…'}
        </div>
      </main>
    );
  }

  const total = portfolio.totalUsd || 0;
  const liveLabel = status === 'updating' ? 'Updating…' : status === 'error' ? 'Offline' : 'Live';

  return (
    <>
      <header className="topbar">
        <div className="wrap dashnav">
          <div className="brand">Crypto<span>Vault</span></div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className={`livestat ${status === 'live' ? 'on' : status === 'error' ? 'bad' : ''}`}>
              <i />{liveLabel}
            </span>
            <button className="btn" onClick={refreshNow} disabled={status === 'updating'}>
              {status === 'updating' ? 'Updating…' : '↻ Refresh now'}
            </button>
            <button className="btn ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="wrap dashmain">
        {banner && <div className="banner warn">{banner}</div>}

        <div className="welcome">
          <div>
            <div className="eyebrow">PRIVATE VAULT · WATCH-ONLY</div>
            <h1>Your wallet command center</h1>
            <div className="muted lastupdated" style={{ marginTop: 7 }}>
              {lastUpdated
                ? `Last updated: ${lastUpdated.toLocaleTimeString()} · prices refresh automatically`
                : 'Loading portfolio…'}{' '}
              · Public addresses only.
            </div>
          </div>
          <button className="btn primary" onClick={() => { setModal(true); setError(''); setVerifyAction(false); setResendState(''); }}>
            ＋ Add wallet
          </button>
        </div>

        <section className="stats">
          <div className="stat">
            <small>Total portfolio value</small>
            <div className="big">{usd(total)}</div>
            {portfolio.hasUnpriced && (
              <div className="statnote">Some assets could not be priced — total excludes them.</div>
            )}
          </div>
          <div className="stat">
            <small>Wallets monitored</small>
            <div className="big">{data.wallets.length}</div>
          </div>
          <div className="stat">
            <small>Recent alerts</small>
            <div className="big">{data.notifications.length}</div>
          </div>
        </section>

        <section className="section settingscard">
          <div>
            <h2>Monitoring</h2>
            <p className="muted">Choose exactly what Crypto Vault watches and emails you about.</p>
          </div>
          <div className="toggles">
            <Toggle label="Notify on deposits" checked={settings.notifyDeposits} onChange={(v) => updateSetting('notifyDeposits', v)} />
            <Toggle label="Notify on withdrawals" checked={settings.notifyWithdrawals} onChange={(v) => updateSetting('notifyWithdrawals', v)} />
            <Toggle label="Notify on token deposits" checked={settings.notifyTokenDeposits} onChange={(v) => updateSetting('notifyTokenDeposits', v)} />
            <Toggle label="Token monitoring" checked={settings.tokenMonitoringEnabled} onChange={(v) => updateSetting('tokenMonitoringEnabled', v)} />
            <div className="minimum">
              <label>Minimum notification (USD)</label>
              <div>
                <span>$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={settings.minimumNotificationUsd}
                  onChange={(e) => setSettings({ ...settings, minimumNotificationUsd: e.target.value })}
                  onBlur={(e) => updateSetting('minimumNotificationUsd', e.target.value)}
                />
              </div>
              <small className="muted">0 = notify for every deposit, however small.</small>
            </div>
          </div>
          <div className="muted emailline">
            Email: <strong>{settings.email}</strong>{' '}
            {settings.emailVerifiedAt ? (
              <>· verified</>
            ) : (
              <>· <strong>not verified</strong> · <button className="linkbtn" onClick={resendVerification} disabled={resendState === 'sending'}>
                {resendState === 'sending' ? 'sending…' : resendState === 'sent' ? 'verification email sent ✓' : 'send verification email'}
              </button></>
            )}
          </div>
        </section>

        <section className="section">
          <div className="sectionhead">
            <h2>Wallets</h2>
            <span className="muted">{data.wallets.length} connected</span>
          </div>
          {data.wallets.length ? (
            data.wallets.map((w) => {
              const c = data.chains.find((x) => x.id === w.chain);
              const p = portfolio.wallets.find((x) => x.id === w.id);
              return (
                <div className="wallet" key={w.id}>
                  <div className="walletleft">
                    <div className="coin">{c?.symbol?.slice(0, 3) || '?'}</div>
                    <div>
                      <h3>{w.label}</h3>
                      <code>{c?.name || w.chain} · {shortAddress(w.address)}</code>
                    </div>
                  </div>
                  <div className="balance">
                    <strong>
                      {fmt(p?.nativeAmount ?? w.lastNativeAmount)} {c?.symbol}
                      <span className="usdline">
                        {p && p.priceAvailable && p.nativeUsdValue != null
                          ? usd(p.nativeUsdValue)
                          : 'Price unavailable'}
                      </span>
                    </strong>
                    <span>
                      {timeAgo(w.lastCheckedAt, now)} ·{' '}
                      <button onClick={() => remove(w.id)} className="linkdanger">remove</button>
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty">
              Your vault is empty.<br />
              <button className="btn primary" style={{ marginTop: 15 }} onClick={() => setModal(true)}>Add your first wallet</button>
            </div>
          )}
        </section>

        {settings.tokenMonitoringEnabled && (
          <section className="section">
            <div className="sectionhead">
              <div>
                <h2>Tokens &amp; assets</h2>
                <span className="muted">ERC-20 and discovered token balances where supported</span>
              </div>
            </div>
            {portfolio.tokens.length ? (
              portfolio.tokens.map((t, i) => (
                <div className="wallet" key={(t.walletId || '') + '-' + (t.tokenAddress || t.symbol) + '-' + i}>
                  <div>
                    <h3>{t.symbol} <span className="muted">{t.name}</span></h3>
                    <code>{t.chainName} · {t.walletLabel}</code>
                  </div>
                  <div className="balance">
                    <strong>{fmt(t.amount)} {t.symbol}</strong>
                    <span className="usdline">
                      {t.priceAvailable && t.usdValue != null ? usd(t.usdValue) : 'Price unavailable'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">No token balances found on the indexed networks yet.</div>
            )}
          </section>
        )}

        <section className="section">
          <div className="sectionhead"><h2>Recent alerts</h2></div>
          {data.notifications.length ? (
            data.notifications.map((n) => (
              <div className="wallet" key={n.id}>
                <div>
                  <h3>{n.type === 'token-deposit' ? '🪙' : n.type === 'withdrawal' ? '↗' : '💰'} {n.amount} {n.symbol} {n.type === 'withdrawal' ? 'sent' : 'received'}</h3>
                  <code>{n.chain} · {new Date(n.createdAt).toLocaleString()} {n.txHash ? '· ' + n.txHash.slice(0, 10) + '…' : ''}</code>
                </div>
                <div className="muted">{n.usdValue != null && n.usdValue !== '' ? usd(n.usdValue) : 'Price unavailable'}</div>
              </div>
            ))
          ) : (
            <div className="empty">No alerts yet.</div>
          )}
        </section>

        <section className="section">
          <div className="sectionhead">
            <div>
              <h2>Transaction activity</h2>
              <span className="muted">Decoded on-chain activity where supported</span>
            </div>
          </div>
          {activity.length ? (
            activity.map((x, i) => (
              <div className="wallet" key={(x.hash || 'tx') + i}>
                <div>
                  <h3>{x.type}</h3>
                  <code>{x.chain} · {x.hash ? x.hash.slice(0, 14) + '…' : '—'}</code>
                </div>
                <div className="balance">
                  <strong>{x.value ? `${fmt(x.value)} ${x.symbol}` : 'Contract interaction'}</strong>
                  <span>{x.timestamp ? new Date(x.timestamp).toLocaleString() : ''}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">No indexed transaction activity yet.</div>
          )}
        </section>
      </main>

      {modal && (
        <div className="modal">
          <div className="modalbox">
            <div className="modalhead">
              <div>
                <h2 style={{ margin: '0 0 5px' }}>Add wallet</h2>
                <div className="muted">Only public addresses. Never paste keys.</div>
              </div>
              <button className="close" onClick={() => setModal(false)} aria-label="Close">×</button>
            </div>
            <form onSubmit={add}>
              <div className="field">
                <label>Wallet name</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main ETH wallet" required />
              </div>
              <div className="field">
                <label>Network</label>
                <select value={chain} onChange={(e) => setChain(e.target.value)}>
                  {data.chains.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.symbol}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Public address</label>
                <input
                  value={address} onChange={(e) => setAddress(e.target.value)}
                  placeholder={chain === 'solana' ? 'Solana address' : chain === 'bitcoin' ? 'bc1…' : '0x…'}
                  autoComplete="off" required
                />
              </div>
              {error && (
                <div className="err">
                  {error}
                  {verifyAction && (
                    <div style={{ marginTop: 10 }}>
                      {resendState === 'sent' ? (
                        <span className="muted">Verification email sent — check your inbox.</span>
                      ) : (
                        <button type="button" className="btn sm" onClick={resendVerification} disabled={resendState === 'sending'}>
                          {resendState === 'sending' ? 'Sending…' : 'Resend verification email'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button className="btn primary full" disabled={busy}>{busy ? 'Adding…' : 'Add to vault'}</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}
