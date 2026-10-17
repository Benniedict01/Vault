import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALERT_DEPOSIT,
  ALERT_WITHDRAWAL,
  ALERT_TOKEN_DEPOSIT,
  classifyBalanceChange,
  decideAlert,
  evaluateWithdrawal,
  isAlertKindEnabled,
  isUsdThresholdMet,
} from '../lib/alerts.mjs';

const ALL_ON = { notifyDeposits: true, notifyWithdrawals: true, notifyTokenDeposits: true };

test('classifyBalanceChange reports a deposit, a withdrawal or nothing', () => {
  assert.deepEqual(classifyBalanceChange('1', '1.5'), { kind: ALERT_DEPOSIT, amount: 0.5 });
  assert.deepEqual(classifyBalanceChange('1', '0.5'), { kind: ALERT_WITHDRAWAL, amount: 0.5 });
  assert.equal(classifyBalanceChange('1', '1'), null);
  assert.equal(classifyBalanceChange('not-a-number', '1'), null);
});

test('isUsdThresholdMet treats a missing price as unknown, not as zero', () => {
  assert.equal(isUsdThresholdMet(10, '0'), true);
  assert.equal(isUsdThresholdMet(10, '5'), true);
  assert.equal(isUsdThresholdMet(1, '5'), false);
  assert.equal(isUsdThresholdMet(null, '0'), true);
  assert.equal(isUsdThresholdMet(null, '5'), null);
  assert.equal(isUsdThresholdMet(undefined, '5'), null);
});

test('isAlertKindEnabled follows the per kind toggles', () => {
  assert.equal(isAlertKindEnabled(ALERT_DEPOSIT, ALL_ON), true);
  assert.equal(isAlertKindEnabled(ALERT_WITHDRAWAL, ALL_ON), true);
  assert.equal(isAlertKindEnabled(ALERT_TOKEN_DEPOSIT, ALL_ON), true);
  assert.equal(isAlertKindEnabled(ALERT_WITHDRAWAL, { ...ALL_ON, notifyWithdrawals: false }), false);
  assert.equal(isAlertKindEnabled(ALERT_DEPOSIT, { ...ALL_ON, notifyDeposits: false }), false);
  assert.equal(isAlertKindEnabled('something-else', ALL_ON), false);
});

test('decideAlert records and mails a deposit above the threshold', () => {
  const decision = decideAlert({ kind: ALERT_DEPOSIT, usdValue: 25, minimumUsd: '10', settings: ALL_ON });
  assert.deepEqual(decision, { record: true, email: true, reason: 'ok' });
});

test('decideAlert drops an alert below the threshold', () => {
  const decision = decideAlert({ kind: ALERT_DEPOSIT, usdValue: 2, minimumUsd: '10', settings: ALL_ON });
  assert.equal(decision.record, false);
  assert.equal(decision.reason, 'below-threshold');
});

test('decideAlert drops an alert whose toggle is off', () => {
  const decision = decideAlert({
    kind: ALERT_WITHDRAWAL,
    usdValue: 100,
    minimumUsd: '0',
    settings: { ...ALL_ON, notifyWithdrawals: false },
  });
  assert.equal(decision.record, false);
  assert.equal(decision.reason, 'kind-disabled');
});

test('decideAlert keeps the row but skips the mail when the price is unknown', () => {
  const decision = decideAlert({ kind: ALERT_DEPOSIT, usdValue: null, minimumUsd: '10', settings: ALL_ON });
  assert.equal(decision.record, true);
  assert.equal(decision.email, false);
  assert.equal(decision.reason, 'price-unavailable');
});

test('a withdrawal is not alerted on the first sighting', () => {
  const verdict = evaluateWithdrawal({ previous: 1, current: 0.8, pending: null });
  assert.equal(verdict.action, 'wait');
  assert.deepEqual(verdict.nextPending, { from: 1, to: 0.8 });
});

test('a withdrawal is alerted once a second read confirms the low balance', () => {
  const verdict = evaluateWithdrawal({ previous: 0.8, current: 0.8, pending: { from: 1, to: 0.8 } });
  assert.equal(verdict.action, 'confirm');
  assert.ok(Math.abs(verdict.amount - 0.2) < 1e-9);
  assert.equal(verdict.nextPending, null);
});

test('a withdrawal is dropped when the balance recovers', () => {
  const verdict = evaluateWithdrawal({ previous: 0.8, current: 1, pending: { from: 1, to: 0.8 } });
  assert.equal(verdict.action, 'recovered');
  assert.equal(verdict.nextPending, null);
});

test('a second withdrawal restarts the confirmation but keeps the total drop', () => {
  const verdict = evaluateWithdrawal({ previous: 0.8, current: 0.6, pending: { from: 1, to: 0.8 } });
  assert.equal(verdict.action, 'wait');
  assert.deepEqual(verdict.nextPending, { from: 1, to: 0.6 });
});

test('a stable balance raises nothing', () => {
  const verdict = evaluateWithdrawal({ previous: 1, current: 1, pending: null });
  assert.equal(verdict.action, 'none');
  assert.equal(verdict.nextPending, null);
});

test('a tiny drop on a small balance is still confirmed', () => {
  const first = evaluateWithdrawal({ previous: 0.0001, current: 0, pending: null });
  assert.equal(first.action, 'wait');
  const second = evaluateWithdrawal({ previous: 0, current: 0, pending: first.nextPending });
  assert.equal(second.action, 'confirm');
  assert.ok(Math.abs(second.amount - 0.0001) < 1e-12);
});
