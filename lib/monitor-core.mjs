// Monitoring core.
//
// The orchestration of a monitoring run, with every side effect injected:
//
//   db            - the Prisma client
//   readBalance   - reads the native balance of a wallet
//   getPrices     - resolves USD prices for a list of symbols
//   sendAlertEmail- delivers one alert email
//
// `lib/monitor.js` wires the real implementations. The core is written this
// way so the alert flow can be tested without a database or a mail provider
// (see tests/monitor.test.mjs).
//
// The order matters (engineering brief, section 2):
//   1. read the balance through the network adapter
//   2. compare it with the last known amount
//   3. write the Notification row
//   4. send the email
//   5. update lastNativeAmount / lastCheckedAt
//
// Steps 3 and 5 run inside one database transaction, so an alert is never lost
// and never duplicated. Step 4 happens after the transaction: a failed email
// can never lose the alert, it only marks the row for a later retry.
//
// Every wallet is isolated: one failing provider, one broken explorer or one
// rejected email never stops the rest of the run.

import { CHAINS } from './validation.mjs';
import { getEvmTokenTransfers } from './tokens.js';
import { logError, maskAddress, maskEmail } from './log.mjs';
import {
  ALERT_DEPOSIT,
  ALERT_WITHDRAWAL,
  ALERT_TOKEN_DEPOSIT,
  EMAIL_FAILED,
  EMAIL_PENDING,
  EMAIL_SENT,
  EMAIL_SKIPPED,
  classifyBalanceChange,
  decideAlert,
  evaluateWithdrawal,
} from './alerts.mjs';

const EMAIL_MAX_ATTEMPTS = 5;
const EMAIL_RETRY_INTERVAL_MS = 10 * 60 * 1000;

function settingsOf(user) {
  return {
    notifyDeposits: user.notifyDeposits,
    notifyWithdrawals: user.notifyWithdrawals,
    notifyTokenDeposits: user.notifyTokenDeposits,
  };
}

function pendingWithdrawalOf(wallet) {
  if (!wallet.pendingWithdrawalFrom || !wallet.pendingWithdrawalTo) return null;
  return { from: Number(wallet.pendingWithdrawalFrom), to: Number(wallet.pendingWithdrawalTo) };
}

export function createMonitor({ db, readBalance, getPrices, sendAlertEmail, listTokenTransfers }) {
  const collectTokenTransfers = listTokenTransfers || getEvmTokenTransfers;

  /**
   * Send one alert email. The notification row already exists at this point,
   * so a failure only means "not delivered yet" - the row is kept and retried.
   */
  async function deliverNotification(notification, user, wallet, chain, symbol) {
    if (!user.emailVerifiedAt) {
      await db.notification.update({
        where: { id: notification.id },
        data: { emailStatus: EMAIL_SKIPPED, emailLastError: 'email-not-verified' },
      });
      return { sent: false, skipped: true };
    }
    try {
      await sendAlertEmail({
        to: user.email,
        chain,
        wallet,
        kind: notification.type,
        symbol: symbol || notification.symbol,
        amount: Number(notification.amount),
        usdValue: notification.usdValue === null || notification.usdValue === undefined ? null : Number(notification.usdValue),
        txHash: notification.txHash,
      });
      await db.notification.update({
        where: { id: notification.id },
        data: {
          emailStatus: EMAIL_SENT,
          emailSentAt: new Date(),
          emailAttempts: { increment: 1 },
          emailLastError: null,
          emailLastAttemptAt: new Date(),
        },
      });
      return { sent: true, skipped: false };
    } catch (error) {
      logError('email', 'alert email failed', { to: maskEmail(user.email), reason: error.message });
      await db.notification.update({
        where: { id: notification.id },
        data: {
          emailStatus: EMAIL_FAILED,
          emailAttempts: { increment: 1 },
          emailLastError: String(error?.message || 'unknown error').slice(0, 120),
          emailLastAttemptAt: new Date(),
        },
      });
      return { sent: false, skipped: false };
    }
  }

  async function collectTransfers(user, wallet, chain) {
    if (!user.tokenMonitoringEnabled) return [];
    if (chain.kind !== 'evm') return [];
    if (!wallet.lastCheckedAt) return [];
    return collectTokenTransfers(wallet);
  }

  async function monitorWallet(user, wallet, chain, priceMap) {
    const price = priceMap.get(chain.symbol) ?? null;
    const previous = Number(wallet.lastNativeAmount || '0');
    const isFirstObservation = !wallet.lastCheckedAt;
    const settings = settingsOf(user);
    const minimumUsd = user.minimumNotificationUsd;

    // 1. read the current state
    const amount = await readBalance(wallet, chain);
    const transfers = await collectTransfers(user, wallet, chain);

    // 2. decide what to write
    const change = isFirstObservation ? null : classifyBalanceChange(previous, amount);
    const pending = pendingWithdrawalOf(wallet);
    const alerts = [];
    let pendingAction = null;
    let nextPending = null;

    if (pending) {
      // A suspicion is open: the last known balance may be wrong (stale
      // provider data). Compare against the level from before the suspected
      // drop instead of the last stored balance.
      if (amount >= pending.from) {
        // The balance is back at (or above) the level from before the drop:
        // the suspicion is resolved and the net change is a deposit.
        pendingAction = 'clear';
        const netDeposit = amount - pending.from;
        if (netDeposit > 0) {
          const usdValue = price === null ? null : netDeposit * price;
          const decision = decideAlert({ kind: ALERT_DEPOSIT, usdValue, minimumUsd, settings });
          if (decision.record) {
            alerts.push({ kind: ALERT_DEPOSIT, symbol: chain.symbol, amount: netDeposit, usdValue, txHash: null, email: decision.email, reason: decision.reason });
          } else {
            logError('monitor', 'deposit alert suppressed', { chain: chain.name, wallet: maskAddress(wallet.address), reason: decision.reason });
          }
        }
      } else {
        const verdict = evaluateWithdrawal({ previous, current: amount, pending });
        if (verdict.action === 'confirm') {
          const usdValue = price === null ? null : verdict.amount * price;
          const decision = decideAlert({ kind: ALERT_WITHDRAWAL, usdValue, minimumUsd, settings });
          if (decision.record) {
            alerts.push({ kind: ALERT_WITHDRAWAL, symbol: chain.symbol, amount: verdict.amount, usdValue, txHash: null, email: decision.email, reason: decision.reason });
          } else {
            logError('monitor', 'withdrawal alert suppressed', { chain: chain.name, wallet: maskAddress(wallet.address), reason: decision.reason });
          }
          pendingAction = 'clear';
        } else if (verdict.action === 'wait') {
          pendingAction = 'set';
          nextPending = verdict.nextPending;
        } else if (verdict.action === 'recovered') {
          pendingAction = 'clear';
          logError('monitor', 'suspected withdrawal was not confirmed', { chain: chain.name, wallet: maskAddress(wallet.address), reason: 'balance-recovered' });
        }
      }
    } else if (change?.kind === ALERT_DEPOSIT) {
      const usdValue = price === null ? null : change.amount * price;
      const decision = decideAlert({ kind: ALERT_DEPOSIT, usdValue, minimumUsd, settings });
      if (decision.record) {
        alerts.push({ kind: ALERT_DEPOSIT, symbol: chain.symbol, amount: change.amount, usdValue, txHash: null, email: decision.email, reason: decision.reason });
      } else {
        logError('monitor', 'deposit alert suppressed', { chain: chain.name, wallet: maskAddress(wallet.address), reason: decision.reason });
      }
    } else if (change?.kind === ALERT_WITHDRAWAL) {
      const verdict = evaluateWithdrawal({ previous, current: amount, pending: null });
      if (verdict.action === 'wait') {
        pendingAction = 'set';
        nextPending = verdict.nextPending;
      }
    }

    // token deposits (only transfers that arrived since the previous check)
    const tokenAlerts = [];
    if (transfers.length) {
      const since = new Date(wallet.lastCheckedAt).getTime();
      for (const transfer of transfers) {
        if ((transfer.to || '').toLowerCase() !== wallet.address.toLowerCase()) continue;
        if (new Date(transfer.timestamp).getTime() <= since) continue;
        const decision = decideAlert({ kind: ALERT_TOKEN_DEPOSIT, usdValue: transfer.usdValue, minimumUsd, settings });
        if (!decision.record) continue;
        tokenAlerts.push({
          kind: ALERT_TOKEN_DEPOSIT,
          symbol: transfer.symbol,
          amount: transfer.amount,
          usdValue: transfer.usdValue,
          txHash: transfer.txHash,
          email: decision.email,
          reason: decision.reason,
        });
      }
    }

    // 3. write the rows and advance the wallet in one transaction
    const written = await db.$transaction(async (tx) => {
      const rows = [];
      const pendingAlerts = [...alerts, ...tokenAlerts];

      if (tokenAlerts.length) {
        const hashes = tokenAlerts.map((alert) => alert.txHash).filter(Boolean);
        if (hashes.length) {
          const seen = await tx.notification.findMany({
            where: { walletId: wallet.id, txHash: { in: hashes } },
            select: { txHash: true },
          });
          const known = new Set(seen.map((row) => row.txHash));
          for (let i = pendingAlerts.length - 1; i >= 0; i -= 1) {
            const alert = pendingAlerts[i];
            if (alert.txHash && known.has(alert.txHash)) pendingAlerts.splice(i, 1);
          }
        }
      }

      for (const alert of pendingAlerts) {
        const row = await tx.notification.create({
          data: {
            userId: user.id,
            walletId: wallet.id,
            chain: wallet.chain,
            symbol: alert.symbol,
            amount: String(alert.amount),
            usdValue: alert.usdValue === null || alert.usdValue === undefined ? null : String(alert.usdValue),
            txHash: alert.txHash || null,
            type: alert.kind,
            emailStatus: alert.email ? EMAIL_PENDING : EMAIL_SKIPPED,
            emailLastError: alert.email ? null : alert.reason,
          },
        });
        rows.push({ row, alert });
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          lastNativeAmount: String(amount),
          lastNativeUsdValue: price === null ? String(Number(wallet.lastNativeUsdValue || 0)) : String(amount * price),
          lastCheckedAt: new Date(),
          ...(pendingAction === 'set'
            ? { pendingWithdrawalFrom: String(nextPending.from), pendingWithdrawalTo: String(nextPending.to), pendingWithdrawalAt: new Date() }
            : {}),
          ...(pendingAction === 'clear'
            ? { pendingWithdrawalFrom: null, pendingWithdrawalTo: null, pendingWithdrawalAt: null }
            : {}),
        },
      });

      return rows;
    });

    // 4. send the emails, one by one, each isolated from the others
    let emails = 0;
    let failed = 0;
    for (const { row, alert } of written) {
      if (!alert.email) continue;
      const result = await deliverNotification(row, user, wallet, chain, alert.symbol);
      if (result.sent) emails += 1;
      else if (!result.skipped) failed += 1;
    }

    return { alerts: written.length, emails, failed };
  }

  async function monitorUser(userId) {
    const user = await db.user.findUnique({ where: { id: userId }, include: { wallets: true } });
    if (!user) return { checked: 0, alerts: 0, emails: 0, failed: 0 };

    const symbols = user.wallets.map((wallet) => CHAINS[wallet.chain]?.symbol).filter(Boolean);
    const priceMap = await getPrices(symbols);

    let checked = 0;
    let alerts = 0;
    let emails = 0;
    let failed = 0;

    for (const wallet of user.wallets) {
      const chain = CHAINS[wallet.chain];
      if (!chain) {
        failed += 1;
        logError('monitor', 'wallet has an unsupported chain', {
          chain: wallet.chain,
          wallet: maskAddress(wallet.address),
          reason: 'unknown-chain',
        });
        continue;
      }
      try {
        const result = await monitorWallet(user, wallet, chain, priceMap);
        checked += 1;
        alerts += result.alerts;
        emails += result.emails;
        failed += result.failed;
      } catch (error) {
        failed += 1;
        logError('monitor', 'wallet check failed', {
          chain: chain.name,
          wallet: maskAddress(wallet.address),
          reason: error.message,
        });
      }
    }

    return { checked, alerts, emails, failed };
  }

  /**
   * Re-send alerts whose email never went out (provider outage, timeout, a
   * crash between writing the row and sending the mail). Rows that were
   * deliberately skipped - unverified address, notification switched off - are
   * never retried.
   */
  async function retryUnsentAlerts(limit = 25) {
    const candidates = await db.notification.findMany({
      where: {
        emailStatus: { in: [EMAIL_PENDING, EMAIL_FAILED] },
        emailAttempts: { lt: EMAIL_MAX_ATTEMPTS },
        OR: [
          { emailLastAttemptAt: null },
          { emailLastAttemptAt: { lt: new Date(Date.now() - EMAIL_RETRY_INTERVAL_MS) } },
        ],
      },
      include: { user: true, wallet: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const notification of candidates) {
      const chain = CHAINS[notification.chain];
      if (!chain) {
        logError('email', 'retry skipped, unknown chain', { chain: notification.chain, reason: 'unknown-chain' });
        continue;
      }
      const result = await deliverNotification(notification, notification.user, notification.wallet, chain, notification.symbol);
      if (result.sent) sent += 1;
      else if (result.skipped) skipped += 1;
      else failed += 1;
    }

    return { candidates: candidates.length, sent, failed, skipped };
  }

  async function monitorAll() {
    const users = await db.user.findMany({ select: { id: true } });
    let checked = 0;
    let alerts = 0;
    let emails = 0;
    let failed = 0;

    for (const user of users) {
      const result = await monitorUser(user.id);
      checked += result.checked;
      alerts += result.alerts;
      emails += result.emails;
      failed += result.failed;
    }

    const retried = await retryUnsentAlerts();
    return { users: users.length, checked, alerts, emails, failed, retried: retried.sent };
  }

  return { monitorUser, monitorAll, retryUnsentAlerts, monitorWallet, deliverNotification };
}
