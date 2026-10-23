import Link from 'next/link';

// Shown only by `npm run preview`, which sets VAULT_PREVIEW_OUTBOX. In the
// deployed app the variable is unset, so this renders nothing.
export default function PreviewBanner() {
  if (!process.env.VAULT_PREVIEW_OUTBOX) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 12px',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 14px',
        fontSize: '12.5px',
        lineHeight: 1.4,
        background: '#122033',
        color: '#cfe0f5',
        borderBottom: '1px solid #1e3350',
      }}
    >
      <strong style={{ fontWeight: 600 }}>Local preview</strong>
      <span>Email is captured, not sent.</span>
      <Link href="/dev/outbox" style={{ color: '#7fd1ff', textDecoration: 'underline' }}>
        Open the inbox
      </Link>
    </div>
  );
}
