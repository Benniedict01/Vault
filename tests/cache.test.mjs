import test from 'node:test';
import assert from 'node:assert/strict';

import { cacheClear, cacheGet, cacheSet, remember } from '../lib/cache.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeEach(() => cacheClear());

test('cacheGet returns undefined for a missing key', () => {
  assert.equal(cacheGet('missing'), undefined);
});

test('cacheSet stores a value that can be read back', () => {
  cacheSet('key', { a: 1 }, 1000);
  assert.deepEqual(cacheGet('key'), { a: 1 });
});

test('an expired entry is not returned', async () => {
  cacheSet('key', 'value', 20);
  await sleep(40);
  assert.equal(cacheGet('key'), undefined);
});

test('remember only calls the producer once inside the window', async () => {
  let calls = 0;
  const producer = async () => { calls += 1; return 'value'; };
  assert.equal(await remember('key', 1000, producer), 'value');
  assert.equal(await remember('key', 1000, producer), 'value');
  assert.equal(calls, 1);
});

test('remember does not cache a failed producer', async () => {
  let calls = 0;
  const producer = async () => { calls += 1; throw new Error('boom'); };
  await assert.rejects(() => remember('key', 1000, producer));
  await assert.rejects(() => remember('key', 1000, producer));
  assert.equal(calls, 2);
  assert.equal(cacheGet('key'), undefined);
});
