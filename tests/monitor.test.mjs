import test from 'node:test';
import assert from 'node:assert/strict';

import { createMonitor } from '../lib/monitor-core.mjs';

/* ── a very small in-memory stand-in for Prisma ────────────────────────── */

function applyData(row, data) {
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] = (row[key] || 0) + value.increment;
    else row[key] = value;
  }
  return row;
}

function matches(row, where) {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!condition.some((entry) => matches(row, entry))) return false;
      continue;
    }
    if (condition === null) {
      if (row[key] !== null) return false;
      continue;
    }
    if (condition instanceof Date) {
      if (String(row[key]) !== String(condition)) return false;
      continue;
    }
    if (condition && typeof condition === 'object') {
      if ('in' in condition && !condition.in.includes(row[key])) return false;
      if ('lt' in condition && !(row[key] < condition.lt)) return false;
      if ('gt' in condition && !(row[key] > condition.gt)) return false;
      continue;
    }
    if (row[key] !== condition) return false;
  }
  return true;
}

function createFakeDb({ users, wallets, notifications = [] }) {
  const events = [];
  let sequence = 0;

  const client = {
    user: {
      findUnique: async ({ where }) => {
        const user = users.find((entry) => entry.id === where.id);
        if (!user) return null;
        return { ...user, wallets: wallets.filter((wallet) => wallet.userId === user.id) };
      },
      findMany: async () => users.map((user) => ({ id: user.id })),
    },
    wallet: {
      update: async ({ where, data }) => {
        const wallet = wallets.find((entry) => entry.id === where.id);
        applyData(wallet, data);
        events.push('wallet.update');
        return wallet;
      },
    },
    notification: {
      create: async ({ data }) => {
        sequence += 1;
        const row = { id: `n${sequence}`, emailStatus: 'pending', emailAttempts: 0, createdAt: new Date(), ...data };
        notifications.push(row);
        events.push('notification.create');
        return row;
      },
      update: async ({ where, data }) => {
        const row = notifications.find((entry) => entry.id === where.id);
        applyData(row, data);
        events.push('notification.update');
        return row;
      },
      findMany: async ({ where, orderBy, take, include }) => {
        let rows = notifications.filter((row) => matches(row, where));
        if (orderBy?.createdAt) rows = rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        if (take) rows = rows.slice(0, take);
        return rows.map((row) => {
          const copy = { ...row };
          if (include?.user) copy.user = users.find((user) => user.id === row.userId);
          if (include?.wallet) copy.wallet = wallets.find((wallet) => wallet.id === row.walletId);
          return copy;
        });
      },
    },
    $transaction: async (fn) => fn(client),
  };

  return { db: client, events, notifications, wallets };
}

/* ── fixtures ──────────────────────────────────────────────────────────── */

const WALLET = {
  id: 'w1',
  userId: 'u1',
  label: 'Main ETH wallet',
  chain: 'ethereum',
  address: '0x1234567890abcdef1234567890abcdef12345678',
  lastNativeAmount: '1',
  lastNativeUsdValue: '2000',
  lastCheckedAt: new Date(Date.now() - 600000),
};

function user(overrides = {}) {
  return {
    id: 'u1',
    email: 'user@example.com',
    emailVerifiedAt: new Date(),
    notifyDeposits: true,
    notifyWithdrawals: true,
    notifyTokenDeposits: true,
    tokenMonitoringEnabled: true,
    minimumNotificationUsd: '0',
    ...overrides,
  };
}

function setup({ userOverrides = {}, balance = 1.5, mailError = null } = {}) {
  const state = createFakeDb({ users: [user(userOverrides)], wallets: [{ ...WALLET }], notifications: [] });
  const sent = [];
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => balance,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async (message) => {
      state.events.push('email.send');
      sent.push(message);
      if (mailError) throw mailError;
      return { id: 'mail' };
    },
  });
  return { ...state, monitor, sent };
}

/* ── tests ─────────────────────────────────────────────────────────────── */

test('the notification row is written before the email is sent', async () => {
  const { monitor, events, notifications } = setup();
  const result = await monitor.monitorUser('u1');

  assert.equal(result.alerts, 1);
  assert.equal(result.emails, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'deposit');
  assert.equal(notifications[0].amount, '0.5');
  assert.equal(notifications[0].emailStatus, 'sent');

  const created = events.indexOf('notification.create');
  const mailed = events.indexOf('email.send');
  assert.ok(created >= 0 && mailed >= 0);
  assert.ok(created < mailed, 'the row must exist before the mail goes out');
});

test('the new balance is stored with the alert', async () => {
  const { monitor, wallets } = setup();
  await monitor.monitorUser('u1');
  assert.equal(wallets[0].lastNativeAmount, '1.5');
  assert.ok(wallets[0].lastCheckedAt instanceof Date);
});

test('a failed email keeps the alert and does not stop the run', async () => {
  const { monitor, notifications, sent } = setup({ mailError: new Error('Resend error 500') });
  const result = await monitor.monitorUser('u1');

  assert.equal(result.alerts, 1);
  assert.equal(result.emails, 0);
  assert.equal(result.failed, 1);
  assert.equal(sent.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].emailStatus, 'failed');
  assert.equal(notifications[0].emailAttempts, 1);
  assert.ok(notifications[0].emailLastError.includes('Resend error 500'));
});

test('an unverified address still records the alert but sends no email', async () => {
  const { monitor, notifications, sent } = setup({ userOverrides: { emailVerifiedAt: null } });
  const result = await monitor.monitorUser('u1');

  assert.equal(result.alerts, 1);
  assert.equal(result.emails, 0);
  assert.equal(sent.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].emailStatus, 'skipped');
});

test('a deposit below the minimum is not recorded at all', async () => {
  const { monitor, notifications } = setup({ userOverrides: { minimumNotificationUsd: '5000' } });
  const result = await monitor.monitorUser('u1');

  assert.equal(result.alerts, 0);
  assert.equal(notifications.length, 0);
});

test('an unknown price keeps the alert but sends no email', async () => {
  const state = createFakeDb({ users: [user({ minimumNotificationUsd: '10' })], wallets: [{ ...WALLET }], notifications: [] });
  const sent = [];
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => 1.5,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, null])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async (message) => { sent.push(message); },
  });

  const result = await monitor.monitorUser('u1');
  assert.equal(result.alerts, 1);
  assert.equal(result.emails, 0);
  assert.equal(sent.length, 0);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].usdValue, null);
  assert.equal(state.notifications[0].emailStatus, 'skipped');
});

test('a failing provider only skips that wallet', async () => {
  const state = createFakeDb({
    users: [user()],
    wallets: [
      { ...WALLET, id: 'w1', address: '0x1111111111111111111111111111111111111111' },
      { ...WALLET, id: 'w2', address: '0x2222222222222222222222222222222222222222' },
    ],
    notifications: [],
  });
  const monitor = createMonitor({
    db: state.db,
    readBalance: async (wallet) => {
      if (wallet.id === 'w1') throw new Error('all rpc endpoints failed');
      return 2;
    },
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async () => {},
  });

  const result = await monitor.monitorUser('u1');
  assert.equal(result.checked, 1);
  assert.equal(result.failed, 1);
  assert.equal(state.wallets[0].lastNativeAmount, '1', 'the failed wallet keeps its old balance');
  assert.equal(state.wallets[1].lastNativeAmount, '2', 'the next wallet is still processed');
});

test('a withdrawal is only alerted after a second confirming read', async () => {
  const state = createFakeDb({ users: [user()], wallets: [{ ...WALLET }], notifications: [] });
  let balance = 0.8;
  const sent = [];
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => balance,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async (message) => { sent.push(message); },
  });

  await monitor.monitorUser('u1');
  assert.equal(state.notifications.length, 0, 'the first drop is only a suspicion');
  assert.equal(state.wallets[0].pendingWithdrawalFrom, '1');
  assert.equal(state.wallets[0].pendingWithdrawalTo, '0.8');

  balance = 0.8;
  await monitor.monitorUser('u1');
  assert.equal(state.notifications.length, 1, 'the second read confirms the withdrawal');
  assert.equal(state.notifications[0].type, 'withdrawal');
  assert.ok(Math.abs(Number(state.notifications[0].amount) - 0.2) < 1e-9);
  assert.equal(sent.length, 1);
  assert.equal(state.wallets[0].pendingWithdrawalFrom, null);
});

test('a recovered balance produces no withdrawal alert', async () => {
  const state = createFakeDb({ users: [user()], wallets: [{ ...WALLET }], notifications: [] });
  let balance = 0.8;
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => balance,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async () => {},
  });

  await monitor.monitorUser('u1');
  balance = 1;
  await monitor.monitorUser('u1');

  assert.equal(state.notifications.length, 0);
  assert.equal(state.wallets[0].pendingWithdrawalFrom, null);
});

test('a deposit during an open suspicion is reported as the net change', async () => {
  const state = createFakeDb({ users: [user()], wallets: [{ ...WALLET }], notifications: [] });
  let balance = 0.8;
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => balance,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async () => {},
  });

  await monitor.monitorUser('u1');
  assert.equal(state.notifications.length, 0, 'the drop is only a suspicion');

  balance = 1.2;
  await monitor.monitorUser('u1');

  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].type, 'deposit');
  assert.ok(Math.abs(Number(state.notifications[0].amount) - 0.2) < 1e-9, 'the net change from the last known good level');
  assert.equal(state.wallets[0].pendingWithdrawalFrom, null);
});

test('a failed alert is retried, a skipped one is not', async () => {
  const state = createFakeDb({ users: [user()], wallets: [{ ...WALLET }], notifications: [] });
  const sent = [];
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => 1.5,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async (message) => { sent.push(message); },
  });

  state.notifications.push({
    id: 'failed',
    userId: 'u1',
    walletId: 'w1',
    chain: 'ethereum',
    symbol: 'ETH',
    amount: '0.5',
    usdValue: '1000',
    txHash: null,
    type: 'deposit',
    emailStatus: 'failed',
    emailAttempts: 1,
    emailLastError: 'Resend error 500',
    emailLastAttemptAt: new Date(Date.now() - 20 * 60 * 1000),
    createdAt: new Date(Date.now() - 20 * 60 * 1000),
  });
  state.notifications.push({
    id: 'skipped',
    userId: 'u1',
    walletId: 'w1',
    chain: 'ethereum',
    symbol: 'ETH',
    amount: '0.5',
    usdValue: '1000',
    txHash: null,
    type: 'deposit',
    emailStatus: 'skipped',
    emailAttempts: 0,
    emailLastError: 'email-not-verified',
    emailLastAttemptAt: null,
    createdAt: new Date(Date.now() - 20 * 60 * 1000),
  });

  const result = await monitor.retryUnsentAlerts();
  assert.equal(result.candidates, 1);
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(state.notifications.find((row) => row.id === 'failed').emailStatus, 'sent');
  assert.equal(state.notifications.find((row) => row.id === 'skipped').emailStatus, 'skipped');
});

test('an alert is not retried before the retry window is over', async () => {
  const state = createFakeDb({ users: [user()], wallets: [{ ...WALLET }], notifications: [] });
  const sent = [];
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => 1.5,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async (message) => { sent.push(message); },
  });

  state.notifications.push({
    id: 'just-failed',
    userId: 'u1',
    walletId: 'w1',
    chain: 'ethereum',
    symbol: 'ETH',
    amount: '0.5',
    usdValue: '1000',
    txHash: null,
    type: 'deposit',
    emailStatus: 'failed',
    emailAttempts: 1,
    emailLastError: 'Resend error 500',
    emailLastAttemptAt: new Date(),
    createdAt: new Date(),
  });

  const result = await monitor.retryUnsentAlerts();
  assert.equal(result.candidates, 0);
  assert.equal(sent.length, 0);
});

test('the first observation of a wallet never raises an alert', async () => {
  const state = createFakeDb({
    users: [user()],
    wallets: [{ ...WALLET, lastCheckedAt: null, lastNativeAmount: '0' }],
    notifications: [],
  });
  const monitor = createMonitor({
    db: state.db,
    readBalance: async () => 3,
    getPrices: async (symbols) => new Map(symbols.map((symbol) => [symbol, 2000])),
    listTokenTransfers: async () => [],
    sendAlertEmail: async () => {},
  });

  const result = await monitor.monitorUser('u1');
  assert.equal(result.alerts, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.wallets[0].lastNativeAmount, '3');
});
