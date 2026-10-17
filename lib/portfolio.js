// Portfolio engine — server-authoritative calculations.
//
//   balance (from the monitor) x current market price (PriceService) = USD value
//
// A missing price yields `null` USD values and is reported via `hasUnpriced`;
// it is never converted to $0.00. Totals sum only priced assets so the number
// is never silently fabricated.

import { db } from './prisma';
import { CHAINS } from './validation';
import { getChainAdapter } from './chains';
import { getNativeUsdPrices, toUsd } from './pricing/service';

export async function getPortfolio(userId) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { wallets: true } });
  if (!user) return null;

  const prices = await getNativeUsdPrices(user.wallets.map((w) => CHAINS[w.chain]?.symbol));

  const wallets = [];
  const tokens = [];
  let hasUnpriced = false;

  for (const w of user.wallets) {
    const chain = CHAINS[w.chain];
    const adapter = getChainAdapter(w.chain);
    const symbol = chain?.symbol || 'UNKNOWN';
    const nativeAmount = Number(w.lastNativeAmount || 0);
    const nativePrice = prices[symbol] ?? null;
    const nativeUsdValue = toUsd(nativeAmount, nativePrice);
    // Any asset we cannot price makes the total incomplete, regardless of the
    // balance — the UI must say so instead of implying the total is final.
    if (nativePrice == null) hasUnpriced = true;

    wallets.push({
      ...w,
      chainName: chain?.name || w.chain,
      nativeSymbol: symbol,
      nativeAmount,
      nativePrice,
      nativeUsdValue,
      priceAvailable: nativePrice != null,
    });

    if (user.tokenMonitoringEnabled && adapter) {
      let tokenBalances = [];
      try {
        tokenBalances = await adapter.getTokenBalances(w.address);
      } catch {
        // Token discovery is best-effort; native balances above still count.
        hasUnpriced = true;
      }
      for (const t of tokenBalances) {
        const usdValue = toUsd(t.amount, t.price);
        if (t.price == null) hasUnpriced = true;
        tokens.push({
          ...t,
          usdValue,
          priceAvailable: t.price != null,
          walletId: w.id,
          walletLabel: w.label,
          chainName: chain?.name || w.chain,
        });
      }
    }
  }

  const totalUsd =
    wallets.reduce((sum, w) => sum + (w.nativeUsdValue ?? 0), 0) +
    tokens.reduce((sum, t) => sum + (t.usdValue ?? 0), 0);

  return {
    wallets,
    tokens,
    totalUsd,
    hasUnpriced,
    tokenMonitoringEnabled: user.tokenMonitoringEnabled,
    generatedAt: new Date().toISOString(),
  };
}
