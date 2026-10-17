import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chainCatalog,
  looksLikeSecret,
  looksLikeSecretPhrase,
  normalizeAddress,
  validateAddress,
} from '../lib/validation.mjs';

const EVM = '0x1234567890abcdef1234567890abcdef12345678';
const SOLANA = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const BITCOIN = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

test('validateAddress accepts a public address per chain family', () => {
  assert.equal(validateAddress('ethereum', EVM), null);
  assert.equal(validateAddress('base', EVM), null);
  assert.equal(validateAddress('solana', SOLANA), null);
  assert.equal(validateAddress('bitcoin', BITCOIN), null);
});

test('validateAddress rejects wrong formats and unknown chains', () => {
  assert.ok(validateAddress('ethereum', 'not-an-address'));
  assert.ok(validateAddress('solana', EVM));
  assert.ok(validateAddress('bitcoin', EVM));
  assert.equal(validateAddress('dogecoin', EVM), 'Unsupported chain');
  assert.ok(validateAddress('ethereum', ` ${EVM}`));
  assert.ok(validateAddress('ethereum', `${EVM} `));
});

test('normalizeAddress lower cases EVM addresses only', () => {
  const checksummed = '0xAbC1234567890aBc1234567890AbC1234567890';
  assert.equal(normalizeAddress('ethereum', checksummed), checksummed.toLowerCase());
  assert.equal(normalizeAddress('solana', SOLANA), SOLANA);
});

test('looksLikeSecret refuses seed phrases and private keys', () => {
  const mnemonic = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
  const evmKey = 'a'.repeat(64);
  const solanaKey = '4'.repeat(88);
  assert.equal(looksLikeSecret(mnemonic), true);
  assert.equal(looksLikeSecret(evmKey), true);
  assert.equal(looksLikeSecret(`0x${evmKey}`), true);
  assert.equal(looksLikeSecret('b'.repeat(128)), true);
  assert.equal(looksLikeSecret(solanaKey), true);
});

test('looksLikeSecret accepts public addresses', () => {
  assert.equal(looksLikeSecret(EVM), false);
  assert.equal(looksLikeSecret(SOLANA), false);
  assert.equal(looksLikeSecret(BITCOIN), false);
});

test('looksLikeSecretPhrase allows normal labels but refuses key material', () => {
  assert.equal(looksLikeSecretPhrase('My main ETH wallet'), false);
  assert.equal(looksLikeSecretPhrase('a'.repeat(64)), true);
  assert.equal(
    looksLikeSecretPhrase('legal winner thank year wave sausage worth useful legal winner thank yellow'),
    true,
  );
});

test('chainCatalog never exposes provider endpoints', () => {
  const catalog = chainCatalog();
  assert.ok(catalog.length > 0);
  for (const chain of catalog) {
    assert.equal(typeof chain.id, 'string');
    assert.equal(typeof chain.name, 'string');
    assert.equal(typeof chain.symbol, 'string');
    assert.equal(chain.rpc, undefined);
    assert.equal(chain.rpcs, undefined);
    assert.equal(chain.apis, undefined);
  }
});
