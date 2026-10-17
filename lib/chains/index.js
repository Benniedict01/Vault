// Chain service registry.
//
//   ChainService
//     +-- EVM adapter (one implementation covers every EVM network)
//     +-- SolanaAdapter
//     +-- BitcoinAdapter
//
// Adding a network with a new runtime (e.g. Cosmos, Tron) means writing one
// adapter with this shape and registering it here:
//
//   validateAddress(address) -> string|null
//   getNativeBalance(address) -> Promise<number>
//   getTokenBalances(address) -> Promise<TokenBalance[]>
//   detectIncomingTransfers(address, sinceMs) -> Promise<Transfer[]>
//   getTransactions(address, limit) -> Promise<Tx[]>

import { CHAINS } from '../validation';
import { createEvmAdapter } from './evm';
import { solanaAdapter } from './solana';
import { bitcoinAdapter } from './bitcoin';

const SOLANA = solanaAdapter;
const BITCOIN = bitcoinAdapter;
const evmCache = new Map();

export function getChainAdapter(chainId) {
  const meta = CHAINS[chainId];
  if (!meta) return null;
  if (meta.kind === 'solana') return SOLANA;
  if (meta.kind === 'bitcoin') return BITCOIN;
  if (meta.kind === 'evm') {
    if (!evmCache.has(chainId)) evmCache.set(chainId, createEvmAdapter(chainId));
    return evmCache.get(chainId);
  }
  return null;
}

export function isSupportedChain(chainId) {
  return Boolean(CHAINS[chainId]);
}
