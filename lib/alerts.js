// Alert decisions and alert email content.
//
// Deliberately free of database, network and framework imports so the logic can
// be exercised with plain Node (see "Definition of done" in ENGINEERING.md).

// A balance change smaller than this is treated as noise (float rounding when a
// raw on-chain integer is converted to a JavaScript number).
export const AMOUNT_EPSILON = 1e-12;

export const OUTCOME = {
  IGNORED: 'ignored', // the read was not a usable number
  FIRST_READ: 'first-read', // nothing to compare against yet: record only
  UNCHANGED: 'unchanged',
  DEPOSIT: 'deposit', // balance is above the confirmed level
  WITHDRAWAL_PENDING: 'withdrawal-pending', // first drop: park it, do not alert
  WITHDRAWAL_CONFIRMED: 'withdrawal-confirmed', // second consecutive drop: alert
  RECOVERED: 'recovered', // parked drop went away: provider lag, stay quiet
};

/**
 * Decide what a fresh balance reading means for a wallet.
 *
 * Failsafe 5.3: a single reading that shows less than the confirmed balance is
 * not enough to raise a withdrawal alert. It is parked as "pending" and only
 * becomes an alert when the next reading still shows a drop. If the next
 * reading is back at (or above) the confirmed level, the parked drop is
 * discarded and nothing is sent, so a provider that briefly returns zero
 * cannot produce a false alarm.
 *
 * @param {object} input
 * @param {number} input.amount            balance just read
 * @param {number|null|undefined} input.confirmedAmount  balance the last alert was decided against
 * @param {number|null|undefined} input.pendingAmount    a drop seen on the previous run, if any
 * @returns {{outcome: string, confirmedAmount: number|null, pendingAmount: number|null, change: number}}
 *          `change` is the size of the movement to alert on (0 when there is none).
 */
export function decideBalanceChange({ amount, confirmedAmount, pendingAmount }) {
  const read = Number(amount);
  const confirmed = confirmedAmount == null ? null : Number(confirmedAmount);
  const pending = pendingAmount == null ? null : Number(pendingAmount);

  if (!Number.isFinite(read)) {
    return { outcome: OUTCOME.IGNORED, confirmedAmount: confirmed, pendingAmount: pending, change: 0 };
  }

  // First successful read after the wallet was added: nothing to compare with.
  if (confirmed == null || !Number.isFinite(confirmed)) {
    return { outcome: OUTCOME.FIRST_READ, confirmedAmount: read, pendingAmount: null, change: 0 };
  }

  if (pending != null && Number.isFinite(pending)) {
    // Second read after a drop. Still below the confirmed level -> confirmed.
    if (read < confirmed - AMOUNT_EPSILON) {
      return {
        outcome: OUTCOME.WITHDRAWAL_CONFIRMED,
        confirmedAmount: read,
        pendingAmount: null,
        change: confirmed - read,
      };
    }
    // Back at or above the confirmed level -> the drop was provider lag.
    // A genuine deposit that landed meanwhile is alerted on the next run,
    // when the new balance is confirmed.
    return { outcome: OUTCOME.RECOVERED, confirmedAmount: confirmed, pendingAmount: null, change: 0 };
  }

  if (read > confirmed + AMOUNT_EPSILON) {
    return { outcome: OUTCOME.DEPOSIT, confirmedAmount: read, pendingAmount: null, change: read - confirmed };
  }

  if (read < confirmed - AMOUNT_EPSILON) {
    return {
      outcome: OUTCOME.WITHDRAWAL_PENDING,
      confirmedAmount: confirmed,
      pendingAmount: read,
      change: 0,
    };
  }

  return { outcome: OUTCOME.UNCHANGED, confirmedAmount: confirmed, pendingAmount: null, change: 0 };
}

/** Whether the user's settings allow this kind of alert at all. */
export function notificationAllowed(user, kind) {
  if (!user) return false;
  if (kind === 'withdrawal') return Boolean(user.notifyWithdrawals);
  if (kind === 'token-deposit') return Boolean(user.notifyTokenDeposits);
  return Boolean(user.notifyDeposits);
}

/**
 * Whether the movement clears the user's minimum USD threshold.
 *
 * A missing USD value means the price feed did not answer. The balance change
 * is still real, so the alert is allowed through rather than silently dropped;
 * the email says the value is unavailable.
 */
export function passesMinimum(user, usdValue) {
  const minimum = Number(user?.minimumNotificationUsd || 0);
  if (!Number.isFinite(minimum) || minimum <= 0) return true;
  if (usdValue == null || !Number.isFinite(Number(usdValue))) return true;
  return Number(usdValue) >= minimum;
}

/** Format an amount without trailing zeros, e.g. 0.42000000 -> 0.42. */
export function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0';
  const fixed = amount.toFixed(8);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

function valueLine(usdValue) {
  if (usdValue == null || !Number.isFinite(Number(usdValue))) {
    return 'Estimated value: unavailable (the price feed did not respond)';
  }
  return `Estimated value: $${Number(usdValue).toFixed(2)}`;
}

/**
 * Build the subject and plain-text body for an alert email.
 *
 * Plain text only: no HTML, no links, no secrets. The owner's own address is
 * included so they can tell which wallet moved.
 */
export function buildAlertEmail({ kind, label, address, chainName, symbol, amount, usdValue, txHash }) {
  const formatted = `${formatAmount(amount)} ${symbol}`;
  const wallet = label || 'your wallet';
  const network = chainName || '';

  if (kind === 'token-deposit') {
    return {
      subject: `🪙 ${symbol} received — ${wallet}`,
      text: [
        `${formatted} arrived in ${wallet}.`,
        '',
        `Network: ${network}`,
        valueLine(usdValue),
        `Transaction: ${txHash || 'N/A'}`,
        '',
        'Crypto Vault is watch-only. It never holds a private key or seed phrase.',
      ].join('\n'),
    };
  }

  const verb = kind === 'withdrawal' ? 'left' : 'arrived in';
  const subject = kind === 'withdrawal' ? `📤 Withdrawal — ${wallet}` : `💰 Deposit — ${wallet}`;
  return {
    subject,
    text: [
      `${formatted} ${verb} ${wallet}.`,
      '',
      `Network: ${network}`,
      `Wallet: ${address || 'n/a'}`,
      valueLine(usdValue),
      ...(txHash ? [`Transaction: ${txHash}`] : []),
      '',
      'Crypto Vault is watch-only. It never holds a private key or seed phrase.',
    ].join('\n'),
  };
}
