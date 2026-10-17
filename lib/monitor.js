// Wallet monitoring engine.
//
// Watch-only: reads public balances/transfers, compares with the last observed
// state, and notifies the wallet owner's own email. The engine is idempotent:
// every detected event is claimed in the ProcessedEvent ledger before any
// notification is sent, so re-running the monitor (cron overlap, crash retry,
// double-click) never duplicates an alert.

import { db } from './prisma';
import { CHAINS } from './validation';
import { getChainAdapter } from './chains';
import { getNativeUsdPrices, toUsd } from './pricing/service';
import { sendWalletDepositNotification, userMessage } from './email/service';

/** Controlled retry for transient provider failures. */
async function withRetry(fn, { attempts = 2, delayMs = 400 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Claim a deterministic event key. Returns false when this event was already
 * processed (unique-constraint collision) — the caller must then skip any
 * notification side effects.
 */
async function claimEvent(key, { type, userId, walletId }) {
  try {
    await db.processedEvent.create({ data: { key, type, userId, walletId } });
    return true;
  } catch (err) {
    if (err?.code === 'P2002') return false;
    throw err;
  }
}

/**
 * Minimum-USD gate. `0` means "no threshold" and must not be converted into a
 * different value: even dust qualifies. A null USD value (price unavailable)
 * also qualifies — we never silently drop a real deposit just because a price
 * provider failed.
 */
function belowThreshold(user, usdValue) {
  const min = Number(user.minimumNotificationUsd || 0);
  if (!(min > 0)) return false;
  if (usdValue == null) return false;
  return usdValue < min;
}

async function recordNotification({ user, wallet, symbol, amount, usdValue, txHash, type }) {
  return db.notification.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      chain: wallet.chain,
      symbol,
      amount: String(amount),
      usdValue: usdValue == null ? null : String(usdValue),
      txHash: txHash || null,
      type,
    },
  });
}

/**
 * Notify the wallet owner about one on-chain event. Email failures are logged
 * and recorded (EmailEvent) but never abort the monitor run; the event still
 * appears in the user's in-app alerts.
 */
async function notifyOnce({ user, wallet, eventKey, type, symbol, amount, usdValue, txHash, action }) {
  if (!user.emailVerifiedAt) return false;
  if (type === 'withdrawal' && !user.notifyWithdrawals) return false;
  if (type === 'deposit' && !user.notifyDeposits) return false;
  if (type === 'token-deposit' && !user.notifyTokenDeposits) return false;
  if (belowThreshold(user, usdValue)) return false;

  const claimed = await claimEvent(eventKey, { type, userId: user.id, walletId: wallet.id });
  if (!claimed) return false; // already notified for this exact event

  await recordNotification({ user, wallet, symbol, amount, usdValue, txHash, type });

  try {
    await sendWalletDepositNotification(user, {
      walletLabel: wallet.label,
      chainName: CHAINS[wallet.chain]?.name || wallet.chain,
      address: wallet.address,
      action: action || (type === 'withdrawal' ? 'withdrawal' : 'deposit'),
      amount,
      symbol,
      usdValue,
      txHash,
    });
  } catch (err) {
    // Delivery failure is already logged + recorded by the email service.
    console.warn('[monitor] notification email failed', {
      type, walletId: wallet.id, friendly: userMessage(err),
    });
  }
  return true;
}

/**
 * Monitor every wallet of one user.
 * @returns {Promise<{ checked: number, alerts: number, degraded: Array }>}
 */
export async function monitorUser(userId) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { wallets: true } });
  if (!user) return { checked: 0, alerts: 0, degraded: [] };

  const prices = await getNativeUsdPrices(user.wallets.map((w) => CHAINS[w.chain]?.symbol));
  let alerts = 0;
  const degraded = [];

  for (const w of user.wallets) {
    const chain = CHAINS[w.chain];
    const adapter = getChainAdapter(w.chain);
    if (!chain || !adapter) {
      degraded.push({ walletId: w.id, chain: w.chain, reason: 'unsupported_chain' });
      continue;
    }

    try {
      // 1. Current native balance, with controlled retry.
      const amount = await withRetry(() => adapter.getNativeBalance(w.address));

      const previous = Number(w.lastNativeAmount || '0');
      const increase = amount - previous;
      const decrease = previous - amount;
      const price = prices[chain.symbol] ?? null;
      const usdValue = toUsd(amount, price);
      const lastCheckedKey = w.lastCheckedAt ? new Date(w.lastCheckedAt).getTime() : 'genesis';

      // 2. Native balance-diff events. The event key includes the previous
      // observed state, so a crash-and-retry cycle re-detects the same delta
      // but cannot claim (and therefore cannot re-notify) it twice.
      if (w.lastCheckedAt && increase > 0) {
        await notifyOnce({
          user, wallet: w,
          eventKey: `native:${w.id}:${previous}->${amount}:${lastCheckedKey}`,
          type: 'deposit',
          symbol: chain.symbol,
          amount: increase,
          usdValue: toUsd(increase, price),
          action: 'deposit',
        }) && alerts++;
      } else if (w.lastCheckedAt && decrease > 0 && user.notifyWithdrawals) {
        await notifyOnce({
          user, wallet: w,
          eventKey: `native-out:${w.id}:${previous}->${amount}:${lastCheckedKey}`,
          type: 'withdrawal',
          symbol: chain.symbol,
          amount: decrease,
          usdValue: toUsd(decrease, price),
          action: 'withdrawal',
        }) && alerts++;
      }

      // 3. Token deposits (adapters that support transfer detection).
      if (user.emailVerifiedAt && user.tokenMonitoringEnabled && user.notifyTokenDeposits && adapter.detectIncomingTransfers) {
        const since = w.lastCheckedAt ? new Date(w.lastCheckedAt).getTime() : Date.now();
        let transfers = [];
        try {
          transfers = await adapter.detectIncomingTransfers(w.address, since);
        } catch (err) {
          degraded.push({ walletId: w.id, chain: w.chain, reason: 'transfer_scan_failed' });
        }
        for (const t of transfers) {
          const tUsd = toUsd(t.amount, t.price);
          const eventKey = `token:${w.chain}:${t.txHash || 'nohash'}:${t.tokenAddress || t.symbol}:${t.amount}:${w.id}:${t.timestamp || since}`;
          await notifyOnce({
            user, wallet: w,
            eventKey,
            type: 'token-deposit',
            symbol: t.symbol,
            amount: t.amount,
            usdValue: tUsd,
            txHash: t.txHash,
            action: 'deposit',
          }) && alerts++;
        }
      }

      // 4. Persist observed state last: if anything above crashed mid-way,
      // the next run re-detects the same delta and the ProcessedEvent ledger
      // makes the retry idempotent.
      await db.wallet.update({
        where: { id: w.id },
        data: {
          lastNativeAmount: String(amount),
          lastNativeUsdValue: usdValue == null ? '' : String(usdValue),
          lastCheckedAt: new Date(),
        },
      });
    } catch (err) {
      // One broken wallet/chain must not stop monitoring for everyone else.
      console.error('[monitor] wallet check failed', {
        chain: w.chain, walletId: w.id, message: err?.message,
      });
      degraded.push({ walletId: w.id, chain: w.chain, reason: 'provider_unavailable' });
    }
  }

  return { checked: user.wallets.length, alerts, degraded };
}

/** Monitor every user (cron entry point). Failures are isolated per user. */
export async function monitorAll() {
  const users = await db.user.findMany({ select: { id: true } });
  let checked = 0;
  let alerts = 0;
  const degraded = [];
  for (const u of users) {
    try {
      const r = await monitorUser(u.id);
      checked += r.checked;
      alerts += r.alerts;
      degraded.push(...r.degraded);
    } catch (err) {
      console.error('[monitor] user run failed', { userId: u.id, message: err?.message });
      degraded.push({ userId: u.id, reason: 'user_run_failed' });
    }
  }
  return { users: users.length, checked, alerts, degraded };
}
