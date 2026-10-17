// Public monitoring API.
//
// This module wires the real providers, the real database and the real mail
// transport into the monitoring core (`lib/monitor-core.mjs`). The core holds
// the logic and is unit tested with fakes.

import { db } from './prisma';
import { createMonitor } from './monitor-core.mjs';
import { readBalance } from './providers.mjs';
import { getPrices } from './prices.mjs';
import { sendAlertEmail } from './mail.js';
import { getEvmTokens, getSolanaTokens } from './tokens.js';
import { CHAINS } from './validation.mjs';

const monitor = createMonitor({ db, readBalance, getPrices, sendAlertEmail });

export function monitorAll() {
  return monitor.monitorAll();
}

export function monitorUser(userId) {
  return monitor.monitorUser(userId);
}

export function retryUnsentAlerts(limit) {
  return monitor.retryUnsentAlerts(limit);
}

/** Balances, tokens and the total USD value of a vault. */
export async function getPortfolio(userId) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { wallets: true } });
  if (!user) return null;

  const symbols = user.wallets.map((wallet) => CHAINS[wallet.chain]?.symbol).filter(Boolean);
  const priceMap = await getPrices(symbols);

  const wallets = [];
  const tokens = [];

  for (const wallet of user.wallets) {
    const chain = CHAINS[wallet.chain];
    if (!chain) continue;
    const native = Number(wallet.lastNativeAmount || '0');
    const price = priceMap.get(chain.symbol) ?? null;
    wallets.push({ ...wallet, nativeUsdValue: price === null ? null : native * price });

    if (!user.tokenMonitoringEnabled) continue;
    if (chain.kind === 'evm') {
      tokens.push(...(await getEvmTokens(wallet)).map((token) => ({ ...token, walletId: wallet.id, walletLabel: wallet.label, chainName: chain.name })));
    } else if (chain.kind === 'solana') {
      tokens.push(...(await getSolanaTokens(wallet.address)).map((token) => ({ ...token, walletId: wallet.id, walletLabel: wallet.label, chainName: chain.name })));
    }
  }

  const totalUsd = wallets.reduce((sum, wallet) => sum + (wallet.nativeUsdValue || 0), 0)
    + tokens.reduce((sum, token) => sum + (token.usdValue || 0), 0);

  return { wallets, tokens, totalUsd, tokenMonitoringEnabled: user.tokenMonitoringEnabled };
}
