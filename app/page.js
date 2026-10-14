import Link from 'next/link';

// Inline icon set (stroke icons, 24px grid) — no icon library needed.
const paths = {
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
  bell: <><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.9 1.9 0 003.4 0" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.2 8.3-8 9-4.8-.7-8-4.5-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></>,
  coins: <><circle cx="9" cy="9" r="5.5" /><circle cx="15.5" cy="15.5" r="5.5" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18h2" /></>,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  down: <path d="M12 4v13M6 11l6 6 6-6" />,
};
function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const networks = ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'Solana', 'Bitcoin'];

const features = [
  { icon: 'layers', title: '28 networks, one vault', text: 'Ethereum, Base, Arbitrum, Solana, Bitcoin and more, side by side on one dashboard with live USD values.' },
  { icon: 'bell', title: 'Deposit & withdrawal alerts', text: 'Get an email when funds arrive or leave. Set a minimum USD amount so small movements never become noise.' },
  { icon: 'coins', title: 'Token tracking', text: 'Follows USDC, USDT, ERC-20 and discovered token balances on supported EVM networks, not just the native coin.' },
  { icon: 'shield', title: 'Watch-only by design', text: 'Public addresses only. Seed phrases and private keys are rejected on sight and never stored.' },
  { icon: 'phone', title: 'Installs like an app', text: 'Add it to your home screen on iPhone or Android for one-tap access to your vault. No app store needed.' },
  { icon: 'pulse', title: 'Activity at a glance', text: 'Recent alerts and decoded on-chain activity sit right under your balances, so you can see what changed.' },
];

const faqs = [
  { q: 'Can Crypto Vault move my funds?', a: 'No. It only reads public blockchain data. It never holds keys, so it has no ability to sign a transaction or move anything.' },
  { q: 'Will you ever ask for my seed phrase or private key?', a: 'Never. The app is built to reject anything that looks like a seed phrase or private key, and it only asks for public addresses.' },
  { q: 'Which networks are supported?', a: 'Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain, Avalanche, Solana, Bitcoin, and 19 more. The full list appears when you add a wallet.' },
  { q: 'How quickly will I be alerted?', a: 'Not instantly. Balances are checked on a recurring schedule, so expect a delay of a few minutes, and sometimes longer if a public data provider is slow. Treat alerts as a safety net, not a trading signal.' },
  { q: 'Why do I need to verify my email?', a: 'Alerts are only sent to verified addresses, so they only ever reach an inbox you control. You can add your first wallet before verifying.' },
];

export default function Home() {
  return (
    <>
      <header className="sitebar">
        <nav className="wrap nav" aria-label="Main">
          <Link href="/" className="brand">Crypto<span>Vault</span></Link>
          <div className="navlinks">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#security">Security</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="navcta">
            <Link className="btn ghost sm" href="/login">Sign in</Link>
            <Link className="btn primary sm" href="/signup">Get started</Link>
          </div>
        </nav>
      </header>

      <main>
        <div className="hero-wrap">
          <section className="hero wrap">
            <div><span className="eyebrow"><span className="dot" />WATCH-ONLY · 28 NETWORKS · NO KEYS</span></div>
            <h1>Never let a deposit land <em>unnoticed.</em></h1>
            <p className="lede">One private vault for every wallet you own. Crypto Vault watches your public addresses and emails you the moment funds move.</p>
            <div className="actions">
              <Link className="btn primary lg" href="/signup">Create your vault <Icon name="arrow" /></Link>
              <Link className="btn lg" href="/login">I already have an account</Link>
            </div>
            <div className="trust">
              <span><Icon name="check" /> No seed phrases</span>
              <span><Icon name="check" /> No private keys</span>
              <span><Icon name="check" /> No wallet connection</span>
            </div>
          </section>

          <div className="preview-wrap wrap">
            <div className="preview" aria-label="Illustrative preview of the Crypto Vault dashboard">
              <div className="pv-top">
                <div>
                  <div className="pv-label">Total portfolio value</div>
                  <div className="pv-total">$48,210.55</div>
                </div>
                <span className="pv-live">LIVE</span>
              </div>
              <div className="pv-row">
                <div className="pv-left"><div className="coin eth">ETH</div><div><div className="pv-name">Main ETH wallet</div><div className="pv-addr">Ethereum · 0x7a3F…c91E</div></div></div>
                <div className="pv-right"><div className="pv-amt">12.4000 ETH</div><div className="pv-usd">$38,440.00</div></div>
              </div>
              <div className="pv-row">
                <div className="pv-left"><div className="coin sol">SOL</div><div><div className="pv-name">Trading wallet</div><div className="pv-addr">Solana · 9xQe…Fv2k</div></div></div>
                <div className="pv-right"><div className="pv-amt">340.50 SOL</div><div className="pv-usd">$7,150.55</div></div>
              </div>
              <div className="pv-row">
                <div className="pv-left"><div className="coin btc">BTC</div><div><div className="pv-name">Cold storage</div><div className="pv-addr">Bitcoin · bc1q…x7m4</div></div></div>
                <div className="pv-right"><div className="pv-amt">0.0420 BTC</div><div className="pv-usd">$2,620.00</div></div>
              </div>
              <div className="pv-toast">
                <div className="pv-bell"><Icon name="down" /></div>
                <div><b>Deposit received</b><small>+0.4200 ETH · Main ETH wallet</small></div>
              </div>
            </div>
            <p className="pv-note">Illustrative preview with sample data.</p>
          </div>
        </div>

        <section className="chains wrap" aria-label="Supported networks">
          <div className="chains-label">WORKS WITH THE NETWORKS YOU ALREADY USE</div>
          <div className="pills">
            {networks.map((n) => <span className="pill" key={n}>{n}</span>)}
            <span className="pill more">+ 19 more</span>
          </div>
        </section>

        <section id="how" className="block wrap center">
          <div className="kicker">How it works</div>
          <h2>Set it up once. Stay in the loop.</h2>
          <p className="sub">No browser extensions, no wallet pop-ups, no signing. Just an address and an inbox.</p>
          <div className="steps">
            <div className="step"><h3>Add a public address</h3><p>Paste an address from any wallet and pick its network. That's the only thing we ever need from you.</p></div>
            <div className="step"><h3>We watch the balance</h3><p>Your vault checks every address on a recurring schedule and compares it with the last balance it saw.</p></div>
            <div className="step"><h3>You get the alert</h3><p>When funds arrive or leave, you get an email with the amount and the network, once your email is verified.</p></div>
          </div>
        </section>

        <section id="features" className="block wrap center" style={{ paddingTop: 20 }}>
          <div className="kicker">Features</div>
          <h2>Everything you need to keep an eye on it all.</h2>
          <div className="features" style={{ textAlign: 'left' }}>
            {features.map((f) => (
              <div className="card" key={f.title}>
                <div className="icon"><Icon name={f.icon} /></div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="security" className="wrap" style={{ paddingBlock: 20 }}>
          <div className="secure">
            <div>
              <div className="kicker">Security</div>
              <h2>Your keys never belong here.</h2>
              <p className="sub">Telling you money arrived doesn't require any authority over that money. Crypto Vault reads public blockchain data and nothing else. Keys and seed phrases stay in your wallet, where they belong.</p>
            </div>
            <div className="lists">
              <div className="list yes">
                <h4>What we ask for</h4>
                <ul>
                  <li><Icon name="check" /> Public wallet addresses</li>
                  <li><Icon name="check" /> An email address for alerts</li>
                </ul>
              </div>
              <div className="list no">
                <h4>What we never ask for</h4>
                <ul>
                  <li><Icon name="x" /> Seed or recovery phrases</li>
                  <li><Icon name="x" /> Private keys</li>
                  <li><Icon name="x" /> Wallet passwords or signing access</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="block wrap center">
          <div className="kicker">FAQ</div>
          <h2>Questions, answered straight.</h2>
          <div className="faq" style={{ textAlign: 'left' }}>
            {faqs.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="wrap" style={{ paddingBottom: 10 }}>
          <div className="cta">
            <h2>Know the moment money lands.</h2>
            <p>Add your first wallet in under a minute. No keys, no connection, nothing to sign.</p>
            <Link className="btn primary lg" href="/signup">Create your vault <Icon name="arrow" /></Link>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <div>
            <Link href="/" className="brand">Crypto<span>Vault</span></Link>
            <p className="fine">A watch-only monitoring tool. It never holds funds or keys. Alerts depend on public blockchain data providers and can be delayed.</p>
          </div>
          <nav aria-label="Footer">
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Create account</Link>
            <a href="#faq">FAQ</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
