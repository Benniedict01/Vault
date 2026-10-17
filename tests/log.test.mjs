import test from 'node:test';
import assert from 'node:assert/strict';

import { maskAddress, maskEmail, safeEndpoint, sanitizeReason } from '../lib/log.mjs';

test('maskAddress keeps the first six and the last four characters', () => {
  const masked = maskAddress('0x1234567890abcdef1234567890abcdef12345678');
  assert.equal(masked, '0x1234…5678');
  assert.ok(!masked.includes('1234567890abcdef'));
});

test('maskAddress copes with short and missing values', () => {
  assert.equal(maskAddress(''), '…');
  assert.equal(maskAddress('abc'), 'ab…');
  assert.equal(maskAddress(undefined), '…');
});

test('maskEmail keeps the domain but hides the local part', () => {
  const masked = maskEmail('someone@example.com');
  assert.equal(masked, 'so…@example.com');
  assert.ok(!masked.includes('someone@'));
});

test('sanitizeReason removes email addresses and long hex blobs', () => {
  const reason = sanitizeReason('failed for someone@example.com key 0x1234567890abcdef1234567890abcdef12345678');
  assert.ok(!reason.includes('someone@example.com'));
  assert.ok(!reason.includes('0x1234567890abcdef1234567890abcdef12345678'));
  assert.ok(reason.includes('[email]'));
});

test('sanitizeReason truncates long messages', () => {
  assert.equal(sanitizeReason('x'.repeat(500), 100).length, 100);
});

test('safeEndpoint returns only the host', () => {
  assert.equal(safeEndpoint('https://ethereum-rpc.publicnode.com/v1?key=abc'), 'ethereum-rpc.publicnode.com');
  assert.equal(safeEndpoint('not a url'), 'unknown');
});
