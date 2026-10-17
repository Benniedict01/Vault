import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/auth';
import { chainCatalog, validateAddress, looksLikeSecret, looksLikeSecretPhrase, normalizeAddress } from '@/lib/validation.mjs';

export async function GET() {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const wallets = await db.wallet.findMany({ where: { userId: uid }, orderBy: { createdAt: 'desc' } });
  const notifications = await db.notification.findMany({ where: { userId: uid }, orderBy: { createdAt: 'desc' }, take: 8 });
  const notificationCount = await db.notification.count({ where: { userId: uid } });

  return NextResponse.json({ wallets, notifications, notificationCount, chains: chainCatalog() });
}

export async function POST(req) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const existingCount = await db.wallet.count({ where: { userId: uid } });
    if (existingCount >= 1) {
      const user = await db.user.findUnique({ where: { id: uid }, select: { emailVerifiedAt: true } });
      if (!user?.emailVerifiedAt) {
        return NextResponse.json({
          error: 'Verify your email before adding a second wallet. Open the verification link sent to your email, or request a new one from Resend Verification.',
          code: 'EMAIL_VERIFICATION_REQUIRED',
        }, { status: 403 });
      }
    }

    const body = await req.json();
    const cleanLabel = String(body?.label || '').trim().slice(0, 60);
    const cleanAddress = String(body?.address || '').trim();
    const chain = String(body?.chain || '');

    if (!cleanLabel) return NextResponse.json({ error: 'Wallet name is required.' }, { status: 400 });

    // A seed phrase or private key is never accepted, in any field.
    if (looksLikeSecretPhrase(cleanLabel) || looksLikeSecret(cleanAddress)) {
      return NextResponse.json({ error: 'Private keys and seed phrases are never accepted. Add a public wallet address.' }, { status: 400 });
    }

    const error = validateAddress(chain, cleanAddress);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const wallet = await db.wallet.create({
      data: { userId: uid, label: cleanLabel, chain, address: normalizeAddress(chain, cleanAddress) },
    });
    return NextResponse.json({ wallet });
  } catch (e) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'That address is already in your vault.' }, { status: 409 });
    }
    console.error('[wallet] add failed', { reason: e?.message });
    return NextResponse.json({ error: 'Unable to add wallet.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  const uid = await getSessionUserId();
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing wallet id.' }, { status: 400 });

  const removed = await db.wallet.deleteMany({ where: { id, userId: uid } });
  return NextResponse.json({ ok: true, removed: removed.count });
}
