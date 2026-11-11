import { db } from './prisma';
import { CHAINS } from './validation';
import { getEvmTokenTransfers } from './tokens';
import { getNativePrices, getTokenPrices, getTokenHoldings, tokenKey } from './market';
import { sendMail } from './mail';

const LOCK_MS = 4 * 60_000;
const MAX_PARALLEL_WALLETS = 4;
const MAX_EMAILS_PER_DRAIN = 25;

async function withRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function rpc(endpoint, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || 'RPC error');
    return payload.result;
  } finally { clearTimeout(timer); }
}

async function readBalance(wallet) {
  const chain = CHAINS[wallet.chain];
  if (chain.kind === 'evm') {
    const hex = await rpc(chain.rpc, 'eth_getBalance', [wallet.address, 'latest']);
    return Number(BigInt(hex)) / 1e18;
  }
  if (chain.kind === 'solana') {
    const result = await rpc(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'getBalance', [wallet.address]);
    return (result?.value || 0) / 1e9;
  }
  if (chain.kind === 'bitcoin') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`https://blockstream.info/api/address/${encodeURIComponent(wallet.address)}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Bitcoin API HTTP ${response.status}`);
      const data = await response.json();
      return ((data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0)) / 1e8;
    } finally { clearTimeout(timer); }
  }
  throw new Error('Unsupported chain');
}

async function prices(symbols) {
  const result = await getNativePrices([...new Set(symbols.filter(Boolean))]);
  return Object.fromEntries(Object.entries(result.prices).map(([symbol, value]) => [symbol, value.usd]));
}

async function acquireLock(key) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_MS);
  try {
    await db.monitorLock.create({ data: { id: key, expiresAt } });
    return true;
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    const claimed = await db.monitorLock.updateMany({ where: { id: key, expiresAt: { lt: now } }, data: { expiresAt } });
    return claimed.count === 1;
  }
}
async function releaseLock(key) {
  await db.monitorLock.deleteMany({ where: { id: key } }).catch(() => {});
}

async function enqueueNotification({ user, wallet, symbol, amount, usdValue, type, txHash = null, eventKey = null, subject, text }) {
  try {
    await db.$transaction(async (tx) => {
      const notification = await tx.notification.create({ data: {
        userId: user.id, walletId: wallet.id, chain: wallet.chain, symbol,
        amount: String(amount), usdValue: usdValue == null ? null : String(usdValue),
        txHash, type, eventKey,
      } });
      await tx.emailOutbox.create({ data: {
        notificationId: notification.id, recipient: user.email, subject, text,
        status: 'pending', nextAttemptAt: new Date(),
      } });
    });
    return true;
  } catch (error) {
    if (error.code === 'P2002' && eventKey) return false;
    throw error;
  }
}

export async function drainEmailOutbox(limit = MAX_EMAILS_PER_DRAIN) {
  const due = await db.emailOutbox.findMany({
    where: { OR: [
      { status: 'pending', nextAttemptAt: { lte: new Date() } },
      { status: 'sending', updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    ] },
    orderBy: { createdAt: 'asc' }, take: Math.min(Math.max(limit, 1), 100),
  });
  let sent = 0, failed = 0;
  for (const item of due) {
    const claimed = await db.emailOutbox.updateMany({
      where: { id: item.id, status: item.status, attempts: item.attempts },
      data: { status: 'sending', attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    try {
      await sendMail({ to: item.recipient, subject: item.subject, text: item.text, idempotencyKey: item.id });
      await db.emailOutbox.update({ where: { id: item.id }, data: { status: 'sent', sentAt: new Date(), lastError: null, text: '' } });
      sent++;
    } catch (error) {
      const attempts = item.attempts + 1;
      const exhausted = attempts >= 8;
      const delayMs = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.min(attempts - 1, 7)));
      await db.emailOutbox.update({ where: { id: item.id }, data: {
        status: exhausted ? 'failed' : 'pending',
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastError: String(error?.message || 'Email delivery failed').slice(0, 500),
      } });
      failed++;
    }
  }
  return { sent, failed, examined: due.length };
}

async function processWallet(user, wallet, nativePrices) {
  const lockKey = `wallet:${wallet.id}`;
  if (!(await acquireLock(lockKey))) return { skipped: true, alerts: 0 };
  let alerts = 0;
  try {
    const chain = CHAINS[wallet.chain];
    if (!chain) throw new Error('Unsupported chain');
    const checkedAt = new Date();
    const amount = await withRetry(() => readBalance(wallet), 3);
    const previous = Number(wallet.lastNativeAmount || 0);
    const increase = amount - previous;
    const decrease = previous - amount;
    const price = nativePrices[chain.symbol];
    const usdValue = price == null ? null : amount * price;
    const tokenMonitoringActive = user.emailVerifiedAt && user.tokenMonitoringEnabled && user.notifyTokenDeposits && chain.kind === 'evm';
    const tokenCursor = wallet.tokenLastCheckedAt || wallet.lastCheckedAt || checkedAt;
    // Seed the independent token cursor before advancing lastCheckedAt. If the indexer
    // then fails, the next run resumes from this older cursor rather than skipping.
    if (tokenMonitoringActive && !wallet.tokenLastCheckedAt) {
      await db.wallet.update({ where: { id: wallet.id }, data: { tokenLastCheckedAt: tokenCursor } });
    }

    // Snapshot update only after the chain read succeeds. Alert + snapshot commit atomically.
    if (wallet.lastCheckedAt && increase > 0 && user.emailVerifiedAt && user.notifyDeposits) {
      const deltaUsd = price == null ? null : increase * price;
      if (deltaUsd !== null && deltaUsd < Number(user.minimumNotificationUsd || 0)) { /* below user threshold */ } else {
      const eventKey = `native:${wallet.id}:${wallet.lastNativeAmount}:${amount}:${wallet.lastCheckedAt?.toISOString() || 'initial'}`;
      const created = await enqueueNotification({ user, wallet, symbol: chain.symbol, amount: increase, usdValue: deltaUsd,
        type: 'deposit', eventKey, subject: `💰 Deposit detected — ${wallet.label}`,
        text: `${increase.toFixed(8)} ${chain.symbol} balance increase detected in ${wallet.label}.\n\nNetwork: ${chain.name}\nWallet: ${wallet.address}\nEstimated value: ${deltaUsd == null ? 'unavailable' : `$${deltaUsd.toFixed(2)}`}\n\nThis is a balance-change alert, not a transaction-level proof. Crypto Vault is watch-only.` });
      if (created) alerts++;
      }
    } else if (wallet.lastCheckedAt && decrease > 0 && user.emailVerifiedAt && user.notifyWithdrawals) {
      const deltaUsd = price == null ? null : decrease * price;
      if (deltaUsd !== null && deltaUsd < Number(user.minimumNotificationUsd || 0)) { /* below user threshold */ } else {
      const eventKey = `native:${wallet.id}:${wallet.lastNativeAmount}:${amount}:${wallet.lastCheckedAt?.toISOString() || 'initial'}`;
      const created = await enqueueNotification({ user, wallet, symbol: chain.symbol, amount: decrease, usdValue: deltaUsd,
        type: 'withdrawal', eventKey, subject: `📤 Balance decrease — ${wallet.label}`,
        text: `${decrease.toFixed(8)} ${chain.symbol} balance decrease detected in ${wallet.label}.\n\nNetwork: ${chain.name}\nWallet: ${wallet.address}\nEstimated value: ${deltaUsd == null ? 'unavailable' : `$${deltaUsd.toFixed(2)}`}\n\nThis is a balance-change alert, not a transaction-level proof. Crypto Vault is watch-only.` });
      if (created) alerts++;
      }
    }
    await db.wallet.update({ where: { id: wallet.id }, data: {
      lastNativeAmount: String(amount), lastNativeUsdValue: String(usdValue ?? 0), lastCheckedAt: checkedAt,
    } });

    // Token cursor is independent. It advances only after the complete indexer response
    // has been fetched and every event has been safely persisted.
    if (tokenMonitoringActive) {
      const cursor = tokenCursor;
      // Re-read a short overlap window; event-key uniqueness removes repeats while
      // protecting against same-second timestamps and slightly delayed indexer events.
      const since = new Date(cursor.getTime() - 2 * 60_000);
      const transfers = await withRetry(() => getEvmTokenTransfers(wallet, since), 2);
      const incoming = transfers.filter(transfer => (transfer.to || '').toLowerCase() === wallet.address.toLowerCase())
        .filter(transfer => { const timestamp = new Date(transfer.timestamp).getTime(); return Number.isFinite(timestamp) && timestamp > since.getTime(); });
      const missingPriceTokens = [...new Map(incoming.filter(transfer => !(Number(transfer.usdValue) > 0) && transfer.tokenAddress)
        .map(transfer => [tokenKey(wallet.chain, transfer.tokenAddress), { chain: wallet.chain, address: transfer.tokenAddress }])).values()];
      const tokenPriceMap = missingPriceTokens.length ? (await getTokenPrices(missingPriceTokens)).prices : new Map();
      for (const transfer of incoming) {
        let usd = Number(transfer.usdValue || 0);
        if (!(usd > 0) && transfer.tokenAddress) usd = transfer.amount * (tokenPriceMap.get(tokenKey(wallet.chain, transfer.tokenAddress))?.usd || 0);
        if (usd < Number(user.minimumNotificationUsd || 0)) continue;
        const eventKey = transfer.eventKey || `token:${wallet.chain}:${transfer.txHash}:${transfer.tokenAddress}:${transfer.amount}`;
        const created = await enqueueNotification({ user, wallet, symbol: transfer.symbol, amount: transfer.amount, usdValue: usd || null,
          type: 'token-deposit', txHash: transfer.txHash, eventKey,
          subject: `🪙 ${transfer.symbol} received — ${wallet.label}`,
          text: `${transfer.amount} ${transfer.symbol} arrived in ${wallet.label}.\n\nNetwork: ${chain.name}\nWallet: ${wallet.address}\nEstimated value: ${usd > 0 ? `$${usd.toFixed(2)}` : 'unavailable'}\nTransaction: ${transfer.txHash || 'N/A'}\nExplorer: ${transfer.explorerUrl || 'See transaction hash on the network explorer'}\n\nCrypto Vault is watch-only.` });
        if (created) alerts++;
      }
      await db.wallet.update({ where: { id: wallet.id }, data: { tokenLastCheckedAt: checkedAt } });
    }
    return { skipped: false, alerts };
  } finally { await releaseLock(lockKey); }
}

async function runWithLimit(items, limit, worker) {
  let index = 0;
  const results = [];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      try { results[current] = await worker(items[current]); }
      catch (error) { results[current] = { error }; }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function monitorUser(userId) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { wallets: true } });
  if (!user) return { checked: 0, alerts: 0, failures: [] };
  let nativePrices = {};
  try { nativePrices = await prices(user.wallets.map(wallet => CHAINS[wallet.chain]?.symbol)); }
  catch (error) { console.error('[monitor] native price lookup failed:', error.message); }
  const results = await runWithLimit(user.wallets, MAX_PARALLEL_WALLETS, wallet => processWallet(user, wallet, nativePrices));
  const failures = results.flatMap((result, index) => result?.error ? [{ label: user.wallets[index].label, chain: user.wallets[index].chain, message: String(result.error.message || 'Monitoring failed') }] : []);
  const skipped = results.filter(result => result?.skipped).length;
  const alerts = results.reduce((sum, result) => sum + (result?.alerts || 0), 0);
  const email = await drainEmailOutbox();
  return { checked: user.wallets.length - skipped - failures.length, skipped, alerts, failures, email };
}

export async function monitorAll() {
  const lockKey = 'global-monitor';
  if (!(await acquireLock(lockKey))) return { skipped: true, reason: 'A monitoring run is already active.' };
  try {
    const users = await db.user.findMany({ select: { id: true } });
    let checked = 0, alerts = 0, skipped = 0;
    const failures = [];
    // Avoid loading every wallet into one long-running sequential request.
    for (let offset = 0; offset < users.length; offset += 20) {
      const batch = users.slice(offset, offset + 20);
      const results = await runWithLimit(batch, 4, user => monitorUser(user.id));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result?.error) failures.push({ userId: batch[i].id, message: result.error.message });
        else { checked += result.checked || 0; alerts += result.alerts || 0; skipped += result.skipped || 0; failures.push(...(result.failures || []).map(f => ({ userId: batch[i].id, ...f }))); }
      }
    }
    const email = await drainEmailOutbox(100);
    return { users: users.length, checked, skipped, alerts, failures, email };
  } finally { await releaseLock(lockKey); }
}

export async function getPortfolio(userId, { force = false } = {}) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { wallets: true } });
  if (!user) return null;
  const warnings = [];
  const native = await getNativePrices(user.wallets.map(wallet => CHAINS[wallet.chain]?.symbol).filter(Boolean), { force });
  warnings.push(...native.warnings);
  const wallets = user.wallets.map(wallet => {
    const chain = CHAINS[wallet.chain]; const price = chain ? native.prices[chain.symbol] : undefined;
    const balance = Number(wallet.lastNativeAmount || 0);
    return { ...wallet, nativeUsdValue: price ? balance * price.usd : 0, priceMissing: !price };
  });
  let tokens = [], summary = { stableUsd: 0, tokenUsd: 0, excludedUsd: 0, excludedCount: 0 };
  if (user.tokenMonitoringEnabled) {
    const holdings = await getTokenHoldings(user.wallets, { force });
    tokens = holdings.tokens; summary = holdings.summary; warnings.push(...holdings.warnings);
  }
  const nativeUsd = wallets.reduce((sum, wallet) => sum + wallet.nativeUsdValue, 0);
  return { wallets, tokens, summary: { ...summary, nativeUsd }, totalUsd: nativeUsd + summary.stableUsd + summary.tokenUsd,
    tokenMonitoringEnabled: user.tokenMonitoringEnabled, warnings, updatedAt: new Date().toISOString() };
}
