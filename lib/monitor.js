import { db } from './prisma';
import { CHAINS, maskAddress } from './validation';
import { getEvmTokens, getEvmTokenTransfers, getSolanaTokens } from './tokens';
import { sendMail } from './mail';
import { buildAlertEmail, decideBalanceChange, notificationAllowed, passesMinimum, OUTCOME } from './alerts';

const PRICE_IDS = { ETH: 'ethereum', SOL: 'solana', BTC: 'bitcoin', POL: 'polygon-ecosystem-token', BNB: 'binancecoin', AVAX: 'avalanche-2', xDAI: 'xdai', MNT: 'mantle', CELO: 'celo', CRO: 'crypto-com-chain', GLMR: 'moonbeam', MOVR: 'moonriver', METIS: 'metis-token', BERA: 'berachain-bera', S: 'sonic-3', SEI: 'sei-token' };

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const HTTP_TIMEOUT_MS = 15000;
const PRICE_TTL_MS = 60 * 1000; // protects the free CoinGecko allowance across dashboard refreshes
const TOKEN_LIST_TTL_MS = 60 * 1000; // protects explorer/indexer quotas (ENGINEERING.md 6.2)
const CACHE_LIMIT = 500;
const RETRY_LIMIT = 20; // unsent alerts retried per monitor run
const MAX_SEND_ATTEMPTS = 5;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_MIN_AGE_MS = 5 * 60 * 1000; // never re-try what this run already tried

// ---- small in-process cache -------------------------------------------------
// Single Render instance, so a per-process cache is enough. Failures are never
// cached; only successful results are.
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) { cache.delete(key); return undefined; }
  return hit.value;
}
function cacheSet(key, value, ttl) {
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, { at: Date.now(), value, ttl });
  return value;
}
async function cached(key, ttl, load) {
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await load();
  if (value !== undefined) cacheSet(key, value, ttl);
  return value;
}

// ---- chain reads ------------------------------------------------------------
async function readJson(url, init, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${label} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function rpc(endpoint, method, params) {
  const json = await readJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }, 'RPC');
  if (json?.error) throw new Error(json.error.message || 'RPC error');
  return json?.result;
}

async function readBalance(wallet, chain) {
  if (chain.kind === 'evm') {
    const hex = await rpc(chain.rpc, 'eth_getBalance', [wallet.address, 'latest']);
    if (typeof hex !== 'string' || !/^0x[0-9a-f]+$/i.test(hex)) throw new Error('RPC returned an unexpected balance');
    return Number(BigInt(hex)) / 1e18;
  }
  if (chain.kind === 'solana') {
    const json = await readJson(SOLANA_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [wallet.address] }),
    }, 'Solana RPC');
    if (json?.error) throw new Error(json.error.message || 'Solana RPC error');
    const lamports = json?.result?.value;
    if (typeof lamports !== 'number' || !Number.isFinite(lamports)) throw new Error('Solana RPC returned an unexpected balance');
    return lamports / 1e9;
  }
  if (chain.kind === 'bitcoin') {
    const stats = await readJson(`https://blockstream.info/api/address/${encodeURIComponent(wallet.address)}`, {}, 'Bitcoin API');
    const satoshis = Number(stats?.chain_stats?.funded_txo_sum || 0) - Number(stats?.chain_stats?.spent_txo_sum || 0);
    if (!Number.isFinite(satoshis)) throw new Error('Bitcoin API returned an unexpected balance');
    return satoshis / 1e8;
  }
  throw new Error(`Unsupported chain kind: ${chain.kind}`);
}

// ---- prices -----------------------------------------------------------------
// Returns { SYMBOL: usd } where a missing/null entry means "unknown", never 0.
// Unknown prices must not be treated as worthless: that would silently suppress
// every USD-threshold alert while the price feed is down.
async function prices(symbols) {
  const wanted = [...new Set(symbols.filter(Boolean))];
  const result = {};
  const missing = [];

  for (const symbol of wanted) {
    const id = PRICE_IDS[symbol];
    if (!id) { result[symbol] = null; continue; }
    const hit = cacheGet(`price:${id}`);
    if (hit === undefined) missing.push([symbol, id]);
    else result[symbol] = hit;
  }

  if (missing.length) {
    const ids = [...new Set(missing.map(([, id]) => id))];
    try {
      const json = await readJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`, {}, 'CoinGecko');
      for (const [symbol, id] of missing) {
        const usd = Number(json?.[id]?.usd);
        result[symbol] = Number.isFinite(usd) && usd > 0 ? usd : null;
        if (result[symbol] != null) cacheSet(`price:${id}`, result[symbol], PRICE_TTL_MS);
      }
    } catch (error) {
      console.warn('[monitor] price lookup failed:', error?.message);
      for (const [symbol] of missing) result[symbol] = null;
    }
  }

  return result;
}

function usdFor(amount, price) {
  return price == null ? null : Number(amount) * price;
}

// ---- alert pipeline ---------------------------------------------------------
// Order matters (ENGINEERING.md 5.1): the Notification row is written first, so
// a failed email never loses the alert. The row carries its own delivery state
// and is retried by a later run.
async function recordAlert(user, wallet, { kind, symbol, amount, usdValue, txHash = null }) {
  return db.notification.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      chain: wallet.chain,
      symbol,
      amount: String(amount),
      usdValue: usdValue == null ? null : String(usdValue),
      txHash: txHash || null,
      type: kind,
      // Explicit: rows default to sentAt = now() so pre-existing rows are not
      // re-emailed after a deploy. New alerts opt in to delivery tracking.
      sentAt: null,
      sendAttempts: 0,
    },
  });
}

// Never throws: one failed email must not stop the wallet (or the run).
async function deliverAlert(notification, user, wallet) {
  const chain = CHAINS[notification.chain];
  const email = buildAlertEmail({
    kind: notification.type,
    label: wallet.label,
    address: wallet.address,
    chainName: chain?.name || notification.chain,
    symbol: notification.symbol,
    amount: notification.amount,
    usdValue: notification.usdValue,
    txHash: notification.txHash,
  });

  try {
    await sendMail({ to: user.email, subject: email.subject, text: email.text });
  } catch (error) {
    const reason = String(error?.message || 'send failed').slice(0, 200);
    console.error(`[monitor] alert email failed (notification ${notification.id}):`, reason);
    try {
      await db.notification.update({
        where: { id: notification.id },
        data: { sendAttempts: { increment: 1 }, sendError: reason },
      });
    } catch (updateError) {
      console.error(`[monitor] could not record delivery failure (notification ${notification.id}):`, updateError?.message);
    }
    return false;
  }

  try {
    await db.notification.update({ where: { id: notification.id }, data: { sentAt: new Date(), sendError: null } });
  } catch (error) {
    // The email went out; a retry would duplicate it only if this also failed.
    console.error(`[monitor] could not mark notification ${notification.id} as sent:`, error?.message);
  }
  return true;
}

/**
 * Record and (if the account allows it) email one alert.
 * Returns true when a Notification row was written, i.e. the dashboard shows it.
 */
async function sendAlert(user, wallet, { kind, symbol, amount, usdValue, txHash = null }) {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return false;
  if (!notificationAllowed(user, kind)) return false;
  if (!passesMinimum(user, usdValue)) return false;

  const notification = await recordAlert(user, wallet, { kind, symbol, amount, usdValue, txHash });

  if (!user.emailVerified) {
    // The row still appears in the dashboard, but it must not sit in the retry
    // queue: verifying an address later should not trigger a backlog of old
    // alerts. Mark it closed for delivery.
    try {
      await db.notification.update({
        where: { id: notification.id },
        data: { sendAttempts: MAX_SEND_ATTEMPTS, sendError: 'skipped: email not verified' },
      });
    } catch (error) {
      console.error(`[monitor] could not mark notification ${notification.id} as skipped:`, error?.message);
    }
    return true;
  }

  await deliverAlert(notification, user, wallet);
  return true;
}

/**
 * Retry alerts that were stored but never emailed (failsafe 5.1).
 * Bounded: a small batch per run, five attempts, and a 24-hour window.
 */
export async function retryPendingAlerts({ limit = RETRY_LIMIT } = {}) {
  const pending = await db.notification.findMany({
    where: {
      sentAt: null,
      sendAttempts: { lt: MAX_SEND_ATTEMPTS },
      createdAt: {
        gt: new Date(Date.now() - RETRY_WINDOW_MS),
        lt: new Date(Date.now() - RETRY_MIN_AGE_MS),
      },
      type: { in: ['deposit', 'withdrawal', 'token-deposit'] },
      user: { emailVerified: true },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    // Only the fields the email needs: never load password hashes or tokens.
    include: {
      user: { select: { email: true, emailVerified: true, notifyDeposits: true, notifyWithdrawals: true, notifyTokenDeposits: true } },
      wallet: { select: { id: true, label: true, address: true } },
    },
  });

  let sent = 0;
  let failed = 0;
  for (const notification of pending) {
    try {
      if (!notificationAllowed(notification.user, notification.type)) {
        await db.notification.update({
          where: { id: notification.id },
          data: { sendAttempts: MAX_SEND_ATTEMPTS, sendError: 'skipped: notification disabled' },
        });
        continue;
      }
      if (await deliverAlert(notification, notification.user, notification.wallet)) sent += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[monitor] alert retry failed (notification ${notification.id}):`, error?.message);
    }
  }
  return { attempted: pending.length, sent, failed };
}

// ---- monitoring -------------------------------------------------------------
async function alertTokenDeposits(user, wallet, chain, sinceMs) {
  const transfers = await getEvmTokenTransfers(wallet);
  for (const transfer of transfers) {
    const to = String(transfer.to || '').toLowerCase();
    if (to !== wallet.address.toLowerCase()) continue;
    const at = new Date(transfer.timestamp).getTime();
    if (!Number.isFinite(at) || at <= sinceMs) continue;
    try {
      await sendAlert(user, wallet, {
        kind: 'token-deposit',
        symbol: transfer.symbol,
        amount: transfer.amount,
        usdValue: transfer.usdValue,
        txHash: transfer.txHash,
      });
    } catch (error) {
      console.error(`[monitor] token alert failed for ${chain.name} ${maskAddress(wallet.address)}:`, error?.message);
    }
  }
}

export async function monitorUser(userId) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      minimumNotificationUsd: true,
      notifyDeposits: true,
      notifyWithdrawals: true,
      notifyTokenDeposits: true,
      tokenMonitoringEnabled: true,
      wallets: true,
    },
  });
  if (!user) return { checked: 0, alerts: 0 };

  const priceBySymbol = await prices(user.wallets.map((w) => CHAINS[w.chain]?.symbol).filter(Boolean));
  let checked = 0;
  let alerts = 0;

  for (const wallet of user.wallets) {
    const chain = CHAINS[wallet.chain];
    // A wallet on a network removed from the registry is kept, never silently
    // dropped, and must not break the rest of the run (5.3).
    if (!chain) {
      console.warn(`[monitor] wallet ${wallet.id} uses unknown chain "${wallet.chain}"; skipped`);
      continue;
    }
    const previousCheck = wallet.lastCheckedAt;
    try {
      const amount = await readBalance(wallet, chain);
      // Legacy rows have no confirmed amount yet: start from the last recorded balance.
      const confirmedAmount = wallet.lastConfirmedAmount != null
        ? Number(wallet.lastConfirmedAmount)
        : (previousCheck ? Number(wallet.lastNativeAmount || 0) : null);

      const decision = decideBalanceChange({
        amount,
        confirmedAmount,
        pendingAmount: wallet.pendingDecreaseAmount == null ? null : Number(wallet.pendingDecreaseAmount),
      });
      if (decision.outcome === OUTCOME.IGNORED) throw new Error('Balance read was not a usable number');

      const price = priceBySymbol[chain.symbol] ?? null;
      const pendingAt = decision.pendingAmount == null ? null : new Date();

      // Persist the reading before alerting so partial progress survives a crash.
      await db.wallet.update({
        where: { id: wallet.id },
        data: {
          lastNativeAmount: String(amount),
          // Keep the last known USD value when the price feed is down.
          ...(price == null ? {} : { lastNativeUsdValue: String(usdFor(amount, price)) }),
          lastCheckedAt: new Date(),
          lastConfirmedAmount: decision.confirmedAmount == null ? null : String(decision.confirmedAmount),
          pendingDecreaseAmount: decision.pendingAmount == null ? null : String(decision.pendingAmount),
          pendingDecreaseAt: pendingAt,
        },
      });
      checked += 1;

      if (decision.outcome === OUTCOME.DEPOSIT) {
        if (await sendAlert(user, wallet, {
          kind: 'deposit', symbol: chain.symbol, amount: decision.change, usdValue: usdFor(decision.change, price),
        })) alerts += 1;
      } else if (decision.outcome === OUTCOME.WITHDRAWAL_CONFIRMED) {
        if (await sendAlert(user, wallet, {
          kind: 'withdrawal', symbol: chain.symbol, amount: decision.change, usdValue: usdFor(decision.change, price),
        })) alerts += 1;
      } else if (decision.outcome === OUTCOME.WITHDRAWAL_PENDING) {
        // Not an alert yet: the next run has to confirm it.
        console.warn(`[monitor] ${chain.name} ${maskAddress(wallet.address)}: balance drop awaiting confirmation`);
      }

      if (user.tokenMonitoringEnabled && user.notifyTokenDeposits && chain.kind === 'evm') {
        await alertTokenDeposits(user, wallet, chain, previousCheck ? new Date(previousCheck).getTime() : Date.now());
      }
    } catch (error) {
      // This wallet only: lastCheckedAt is untouched, so it is retried next run.
      console.error(`[monitor] ${wallet.chain}/${maskAddress(wallet.address)}:`, error?.message || error);
    }
  }

  return { checked, alerts };
}

export async function monitorAll() {
  const users = await db.user.findMany({ select: { id: true } });
  let checked = 0;
  let alerts = 0;
  let failed = 0;

  for (const user of users) {
    try {
      const result = await monitorUser(user.id);
      checked += result.checked;
      alerts += result.alerts;
    } catch (error) {
      failed += 1;
      console.error(`[monitor] user ${user.id} failed:`, error?.message || error);
    }
  }

  // Catch up on alerts that were stored but not emailed (5.1).
  let retry = { attempted: 0, sent: 0, failed: 0 };
  try {
    retry = await retryPendingAlerts();
  } catch (error) {
    console.error('[monitor] unsent-alert retry failed:', error?.message || error);
  }

  return { users: users.length, checked, alerts, failed, retried: retry.sent };
}

export async function getPortfolio(userId) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { tokenMonitoringEnabled: true, wallets: true },
  });
  if (!user) return null;

  const priceBySymbol = await prices(user.wallets.map((w) => CHAINS[w.chain]?.symbol).filter(Boolean));
  const wallets = [];
  const tokens = [];

  for (const wallet of user.wallets) {
    const chain = CHAINS[wallet.chain];
    if (!chain) {
      // Unknown network: keep the wallet visible instead of failing the page.
      wallets.push({ ...wallet, nativeUsdValue: null, unsupported: true });
      continue;
    }
    const amount = Number(wallet.lastNativeAmount || 0);
    const price = priceBySymbol[chain.symbol] ?? null;
    wallets.push({ ...wallet, nativeUsdValue: usdFor(amount, price) });

    if (!user.tokenMonitoringEnabled) continue;
    if (chain.kind !== 'evm' && chain.kind !== 'solana') continue;
    try {
      const key = `tokens:${wallet.chain}:${wallet.address.toLowerCase()}`;
      const list = await cached(key, TOKEN_LIST_TTL_MS, () => (
        chain.kind === 'evm' ? getEvmTokens(wallet) : getSolanaTokens(wallet.address)
      ));
      tokens.push(...list.map((token) => ({
        ...token,
        walletId: wallet.id,
        walletLabel: wallet.label,
        chainName: chain.name,
      })));
    } catch (error) {
      console.error(`[portfolio] token scan failed for ${wallet.chain}/${maskAddress(wallet.address)}:`, error?.message);
    }
  }

  const walletUsd = wallets.reduce((sum, wallet) => sum + Number(wallet.nativeUsdValue || 0), 0);
  const tokenUsd = tokens.reduce((sum, token) => sum + Number(token.usdValue || 0), 0);

  return {
    wallets,
    tokens,
    totalUsd: walletUsd + tokenUsd,
    tokenMonitoringEnabled: user.tokenMonitoringEnabled,
  };
}
