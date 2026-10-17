// Pure alert decision logic.
//
// Every rule that decides *whether* Crypto Vault raises an alert lives here so
// it can be unit tested without a database, a network or a mail provider
// (see tests/alerts.test.js). The monitor only executes the decisions.
//
// Rules come from the engineering brief:
//   - an alert row is written when the change passes the user's threshold and
//     the matching notification toggle is on
//   - a withdrawal needs a second confirming read before it is alerted
//     (failsafe 5.3: stale provider data must not raise a false alarm)

export const ALERT_DEPOSIT = 'deposit';
export const ALERT_WITHDRAWAL = 'withdrawal';
export const ALERT_TOKEN_DEPOSIT = 'token-deposit';

/** Email delivery states stored on a Notification row. */
export const EMAIL_PENDING = 'pending';
export const EMAIL_SENT = 'sent';
export const EMAIL_FAILED = 'failed';
export const EMAIL_SKIPPED = 'skipped';

/** Relative tolerance used when comparing two observed balances. */
export const BALANCE_TOLERANCE = 0.001; // 0.1 %

/**
 * Compare two observed native balances.
 * @returns {{kind: string, amount: number}|null} null when nothing changed.
 */
export function classifyBalanceChange(previous, current) {
  const before = Number(previous);
  const after = Number(current);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  const diff = after - before;
  if (diff > 0) return { kind: ALERT_DEPOSIT, amount: diff };
  if (diff < 0) return { kind: ALERT_WITHDRAWAL, amount: -diff };
  return null;
}

/**
 * Evaluate the user's minimum USD threshold.
 * @returns {true|false|null} null means "cannot be evaluated" (no price).
 */
export function isUsdThresholdMet(usdValue, minimumUsd) {
  const min = Number(minimumUsd);
  if (!Number.isFinite(min) || min <= 0) return true;
  if (usdValue === null || usdValue === undefined) return null;
  const value = Number(usdValue);
  if (!Number.isFinite(value)) return null;
  return value >= min;
}

/** Is the matching notification toggle enabled for this alert kind? */
export function isAlertKindEnabled(kind, settings = {}) {
  if (kind === ALERT_DEPOSIT) return settings.notifyDeposits !== false;
  if (kind === ALERT_WITHDRAWAL) return settings.notifyWithdrawals === true;
  if (kind === ALERT_TOKEN_DEPOSIT) return settings.notifyTokenDeposits !== false;
  return false;
}

/**
 * Decide whether an alert should be recorded at all.
 *
 * `usdValue === null` means the price provider did not answer. When the user
 * asked for a minimum value we cannot evaluate the threshold, so the alert is
 * still recorded (a deposit must never be lost) but the email is not sent.
 */
export function decideAlert({ kind, usdValue, minimumUsd, settings }) {
  if (!isAlertKindEnabled(kind, settings)) {
    return { record: false, email: false, reason: 'kind-disabled' };
  }
  const threshold = isUsdThresholdMet(usdValue, minimumUsd);
  if (threshold === false) {
    return { record: false, email: false, reason: 'below-threshold' };
  }
  if (threshold === null) {
    return { record: true, email: false, reason: 'price-unavailable' };
  }
  return { record: true, email: true, reason: 'ok' };
}

/** Absolute + relative tolerance for a balance comparison. */
export function balanceTolerance(value) {
  const v = Math.abs(Number(value) || 0);
  return Math.max(v * BALANCE_TOLERANCE, 1e-9);
}

/**
 * Withdrawal confirmation (failsafe 5.3).
 *
 * `pending` holds the suspicion recorded on a previous run:
 *   from - balance before the suspected drop
 *   to   - the low balance that was observed
 *
 * A withdrawal is only alerted after a second, consecutive read confirms the
 * balance is still low. If the balance recovers, the suspicion is dropped and
 * nothing is alerted.
 *
 * @returns {{action: 'none'|'wait'|'confirm'|'recovered', amount: number, nextPending: object|null}}
 */
export function evaluateWithdrawal({ previous, current, pending }) {
  const before = Number(previous) || 0;
  const now = Number(current) || 0;

  if (!pending) {
    if (now < before - balanceTolerance(before)) {
      return { action: 'wait', amount: before - now, nextPending: { from: before, to: now } };
    }
    return { action: 'none', amount: 0, nextPending: null };
  }

  const from = Number(pending.from) || 0;
  const to = Number(pending.to) || 0;

  if (Math.abs(now - to) <= balanceTolerance(to)) {
    // Second consecutive read at the same low balance: confirmed.
    return { action: 'confirm', amount: Math.max(from - now, 0), nextPending: null };
  }
  if (now >= from - 1e-9) {
    // The balance came back: the first reading was stale provider data.
    return { action: 'recovered', amount: 0, nextPending: null };
  }
  // The balance moved again: restart the confirmation window but keep the
  // original peak so the total drop is never lost.
  return { action: 'wait', amount: from - now, nextPending: { from, to: now } };
}
