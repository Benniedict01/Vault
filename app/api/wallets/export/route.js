import { NextResponse } from 'next/server';
import { db } from '@/lib/prisma';
import { getSessionUserId } from '@/lib/auth';
import { CHAINS, BLOCKSCOUT } from '@/lib/validation';

function csv(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`; // prevent spreadsheet formula injection
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const walletId = new URL(request.url).searchParams.get('id');
  if (!walletId) return NextResponse.json({ error: 'Missing wallet id.' }, { status: 400 });
  const wallet = await db.wallet.findFirst({ where: { id: walletId, userId } });
  if (!wallet) return NextResponse.json({ error: 'Wallet not found.' }, { status: 404 });
  const notifications = await db.notification.findMany({
    where: { walletId: wallet.id, userId }, orderBy: { createdAt: 'asc' },
  });
  const header = [
    'recorded_at', 'wallet_label', 'wallet_address', 'chain', 'chain_name',
    'asset', 'amount', 'estimated_usd', 'event_type', 'transaction_hash', 'explorer_url',
  ];
  const rows = notifications.map((item) => {
    const explorerBase = BLOCKSCOUT[wallet.chain] || CHAINS[wallet.chain]?.explorer;
    const explorerUrl = item.txHash && explorerBase ? `${explorerBase.replace(/\/$/, '')}/tx/${item.txHash}` : '';
    return [item.createdAt.toISOString(), wallet.label, wallet.address, wallet.chain,
      CHAINS[wallet.chain]?.name || wallet.chain, item.symbol, item.amount, item.usdValue,
      item.type, item.txHash, explorerUrl];
  });
  const columns = ['record_type', ...header, 'note'];
  const infoRows = [
    ['INFO', ...Array(11).fill(''), 'Crypto Vault alert history only; not a complete blockchain transaction statement.'],
    ['INFO', ...Array(11).fill(''), 'Native-asset entries are balance-change detections and may combine multiple on-chain transactions between checks.'],
    ['INFO', new Date().toISOString(), ...Array(10).fill(''), 'Exported at'],
  ];
  const dataRows = rows.map(row => ['ALERT', ...row, '']);
  const body = [columns.map(csv).join(','), ...infoRows.map(row => row.map(csv).join(',')), ...dataRows.map(row => row.map(csv).join(','))].join('\r\n');
  const safeName = wallet.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wallet';
  return new Response(`\uFEFF${body}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cryptovault-${safeName}-history.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
