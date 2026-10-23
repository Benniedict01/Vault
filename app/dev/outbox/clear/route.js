import fs from 'node:fs';
import { NextResponse } from 'next/server';

// Local preview only: empty the captured inbox. Not reachable in production
// (VAULT_PREVIEW_OUTBOX is unset there).
export async function POST(request) {
  const file = process.env.VAULT_PREVIEW_OUTBOX;
  if (file && fs.existsSync(file)) fs.rmSync(file);
  return NextResponse.redirect(new URL('/dev/outbox', request.url), { status: 303 });
}
