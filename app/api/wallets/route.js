import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/auth';
import { CHAINS, validateAddress, looksLikeSecret } from '@/lib/validation';
import { checkWalletAdd } from '@/lib/wallets/policy';
import { rateLimitResponse } from '@/lib/security/rate-limit';

// Serializes a stored wallet for API responses. `lastNativeUsdValue` is an
// empty string when the last check could not price the asset — expose that as
// null so clients can render "Price unavailable" instead of $0.00.
function serializeWallet(w) {
  const usd = w.lastNativeUsdValue === '' || w.lastNativeUsdValue == null ? null : Number(w.lastNativeUsdValue);
  return {
    ...w,
    lastNativeUsdValue: Number.isFinite(usd) ? usd : null,
  };
}

export async function GET() {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const wallets = await db.wallet.findMany({ where: { userId: uid }, orderBy: { createdAt: 'desc' } });
  const notifications = await db.notification.findMany({ where: { userId: uid }, orderBy: { createdAt: 'desc' }, take: 8 });
  return NextResponse.json({
    wallets: wallets.map(serializeWallet),
    notifications,
    chains: Object.entries(CHAINS).map(([id, c]) => ({ id, ...c })),
  });
}

export async function POST(req) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = await rateLimitResponse(req, NextResponse, `wallets:create:${uid}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const cleanLabel = String(body.label || '').trim().slice(0, 60);
    const cleanAddress = String(body.address || '').trim();
    const chain = String(body.chain || '');

    if (!cleanLabel) return NextResponse.json({ error: 'Wallet name is required.' }, { status: 400 });

    // Watch-only guard: anything that looks like a key or seed phrase is
    // rejected before it ever reaches storage or an external API.
    if (looksLikeSecret(cleanAddress)) {
      return NextResponse.json(
        { error: 'Private keys and seed phrases are never accepted. Add a public wallet address.' },
        { status: 400 }
      );
    }

    const err = validateAddress(chain, cleanAddress);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    // Wallet-limit policy — enforced server-side, never trusted from the
    // browser. First wallet is allowed unverified; a second requires a
    // verified email (see lib/wallets/policy.js for future plan limits).
    const currentCount = await db.wallet.count({ where: { userId: uid } });
    const user = await db.user.findUnique({
      where: { id: uid },
      select: { emailVerifiedAt: true, email: true },
    });
    const decision = checkWalletAdd(user, currentCount);
    if (!decision.ok) {
      return NextResponse.json(
        {
          error: decision.message,
          code: decision.code,
          // The UI uses this to offer an obvious "resend verification" action.
          action: decision.code === 'EMAIL_VERIFICATION_REQUIRED' ? 'resend-verification' : undefined,
        },
        { status: 403 }
      );
    }

    const wallet = await db.wallet.create({
      data: { userId: uid, label: cleanLabel, chain, address: cleanAddress },
    });
    return NextResponse.json({ wallet: serializeWallet(wallet) });
  } catch (e) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'That address is already in your vault.' }, { status: 409 });
    }
    console.error('[wallets] create failed', { message: e?.message });
    return NextResponse.json({ error: 'Unable to add wallet.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing wallet id.' }, { status: 400 });
  // Scope to the authenticated user — never trust ids from the browser alone.
  await db.wallet.deleteMany({ where: { id, userId: uid } });
  return NextResponse.json({ ok: true });
}
