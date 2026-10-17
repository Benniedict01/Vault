import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/auth';
import { CHAINS, validateAddress, looksLikeSecret } from '@/lib/validation';

// Only the fields the dashboard needs. RPC endpoints and indexer URLs stay on
// the server.
const publicChains = () => Object.entries(CHAINS).map(([id, chain]) => ({
  id,
  name: chain.name,
  symbol: chain.symbol,
  kind: chain.kind,
}));

const SEED_REFUSAL = 'Private keys and seed phrases are never accepted. Add a public wallet address.';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [wallets, notifications] = await Promise.all([
    db.wallet.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);

  return NextResponse.json({ wallets, notifications, chains: publicChains() });
}

export async function POST(req) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const existingCount = await db.wallet.count({ where: { userId } });
    if (existingCount >= 1) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
      if (!user?.emailVerified) {
        return NextResponse.json({
          error: 'Verify your email before adding a second wallet. Open the verification link sent to your email, or request a new one from Resend Verification.',
          code: 'EMAIL_VERIFICATION_REQUIRED',
        }, { status: 403 });
      }
    }

    const { label, chain, address } = await req.json();
    const rawLabel = String(label || '');
    const rawAddress = String(address || '');
    const cleanLabel = rawLabel.trim().slice(0, 60);
    const cleanAddress = rawAddress.trim();

    // Check the raw input first: slicing a pasted seed phrase must not hide it.
    if (looksLikeSecret(rawLabel) || looksLikeSecret(rawAddress)) {
      return NextResponse.json({ error: SEED_REFUSAL }, { status: 400 });
    }
    if (!cleanLabel) return NextResponse.json({ error: 'Wallet name is required.' }, { status: 400 });

    const validationError = validateAddress(chain, cleanAddress);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const wallet = await db.wallet.create({ data: { userId, label: cleanLabel, chain, address: cleanAddress } });
    return NextResponse.json({ wallet });
  } catch (error) {
    if (error?.code === 'P2002') return NextResponse.json({ error: 'That address is already in your vault.' }, { status: 409 });
    // Reason goes to the server log; the client gets a generic message.
    console.error('[wallets] add failed:', error?.code || error?.message);
    return NextResponse.json({ error: 'Unable to add wallet.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing wallet id.' }, { status: 400 });

  try {
    await db.wallet.deleteMany({ where: { id, userId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[wallets] delete failed:', error?.code || error?.message);
    return NextResponse.json({ error: 'Unable to remove wallet.' }, { status: 500 });
  }
}
