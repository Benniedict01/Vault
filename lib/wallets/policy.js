// Wallet authorization policy.
//
// Central place for "who may add how many wallets". The second-wallet email
// verification rule lives here, enforced server-side in the wallets API.
// Future plans (free / premium / admin limits) extend `limitsFor` only —
// routes and UI keep calling `checkWalletAdd`.
//
// Current policy:
//   - 1st wallet: allowed right after signup (onboarding).
//   - 2nd wallet: requires a verified email address.
//   - Verified users: up to FREE_VERIFIED_MAX_WALLETS on the free plan.

export const WALLET_POLICY = Object.freeze({
  FREE_UNVERIFIED_MAX_WALLETS: 1,
  FREE_VERIFIED_MAX_WALLETS: 10,
});

/**
 * How many wallets this user may have right now.
 * When subscription plans exist, branch on user.plan here.
 */
export function maxWalletsFor(user) {
  if (!user) return 0;
  if (user.emailVerifiedAt) return WALLET_POLICY.FREE_VERIFIED_MAX_WALLETS;
  return WALLET_POLICY.FREE_UNVERIFIED_MAX_WALLETS;
}

/**
 * Decide whether `user` may add one more wallet given `currentCount`.
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
export function checkWalletAdd(user, currentCount) {
  const max = maxWalletsFor(user);
  if (currentCount < max) return { ok: true };

  if (!user?.emailVerifiedAt) {
    return {
      ok: false,
      code: 'EMAIL_VERIFICATION_REQUIRED',
      message: 'Verify your email before adding another wallet.',
    };
  }
  return {
    ok: false,
    code: 'WALLET_LIMIT_REACHED',
    message: `You have reached the wallet limit for your plan (${max}).`,
  };
}
