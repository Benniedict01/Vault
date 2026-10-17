// Network registry and input validation.
//
// One entry per supported chain. `rpcs` is an ordered list of endpoints: the
// first one is the default, the rest are fallbacks that are tried in order
// when a provider fails (failsafe 5.3 in the engineering brief).
//
// `blockExplorer` hosts are used for token balances and transfers. They are
// only referenced server side - the browser never receives an endpoint list.

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BTC = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/;

export const CHAINS = {
  ethereum: {
    name: 'Ethereum', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://eth.llamarpc.com'],
  },
  base: {
    name: 'Base', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://base-rpc.publicnode.com', 'https://base.drpc.org'],
  },
  arbitrum: {
    name: 'Arbitrum One', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum-one.drpc.org'],
  },
  optimism: {
    name: 'Optimism', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'],
  },
  polygon: {
    name: 'Polygon', symbol: 'POL', kind: 'evm',
    rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
  },
  bsc: {
    name: 'BNB Chain', symbol: 'BNB', kind: 'evm',
    rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org'],
  },
  avalanche: {
    name: 'Avalanche C-Chain', symbol: 'AVAX', kind: 'evm',
    rpcs: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche-c.drpc.org'],
  },
  gnosis: {
    name: 'Gnosis', symbol: 'xDAI', kind: 'evm',
    rpcs: ['https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org'],
  },
  linea: {
    name: 'Linea', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://linea-rpc.publicnode.com', 'https://linea.drpc.org'],
  },
  scroll: {
    name: 'Scroll', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://scroll-rpc.publicnode.com', 'https://scroll.drpc.org'],
  },
  zksync: {
    name: 'zkSync Era', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://mainnet.era.zksync.io'],
  },
  mantle: {
    name: 'Mantle', symbol: 'MNT', kind: 'evm',
    rpcs: ['https://rpc.mantle.xyz', 'https://mantle.drpc.org'],
  },
  celo: {
    name: 'Celo', symbol: 'CELO', kind: 'evm',
    rpcs: ['https://forno.celo.org'],
  },
  cronos: {
    name: 'Cronos', symbol: 'CRO', kind: 'evm',
    rpcs: ['https://evm.cronos.org'],
  },
  opbnb: {
    name: 'opBNB', symbol: 'BNB', kind: 'evm',
    rpcs: ['https://opbnb-mainnet-rpc.bnbchain.org'],
  },
  moonbeam: {
    name: 'Moonbeam', symbol: 'GLMR', kind: 'evm',
    rpcs: ['https://rpc.api.moonbeam.network', 'https://moonbeam.drpc.org'],
  },
  moonriver: {
    name: 'Moonriver', symbol: 'MOVR', kind: 'evm',
    rpcs: ['https://rpc.api.moonriver.moonbeam.network', 'https://moonriver.drpc.org'],
  },
  metis: {
    name: 'Metis', symbol: 'METIS', kind: 'evm',
    rpcs: ['https://andromeda.metis.io/?owner=1088'],
  },
  blast: {
    name: 'Blast', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://rpc.blast.io', 'https://blast.drpc.org'],
  },
  mode: {
    name: 'Mode', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://mainnet.mode.network'],
  },
  taiko: {
    name: 'Taiko', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://rpc.mainnet.taiko.xyz'],
  },
  sei_evm: {
    name: 'Sei EVM', symbol: 'SEI', kind: 'evm',
    rpcs: ['https://evm-rpc.sei-apis.com'],
  },
  berachain: {
    name: 'Berachain', symbol: 'BERA', kind: 'evm',
    rpcs: ['https://rpc.berachain.com', 'https://berachain.drpc.org'],
  },
  ink: {
    name: 'Ink', symbol: 'ETH', kind: 'evm',
    rpcs: ['https://rpc-gel.inkonchain.com'],
  },
  sonic: {
    name: 'Sonic', symbol: 'S', kind: 'evm',
    rpcs: ['https://rpc.soniclabs.com', 'https://sonic.drpc.org'],
  },
  robinhood: {
    name: 'Robinhood Chain', symbol: 'ETH', kind: 'evm', chainId: 4663,
    rpcs: ['https://rpc.mainnet.chain.robinhood.com'],
  },
  solana: {
    name: 'Solana', symbol: 'SOL', kind: 'solana',
    rpcs: ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'],
  },
  bitcoin: {
    name: 'Bitcoin', symbol: 'BTC', kind: 'bitcoin',
    apis: ['https://blockstream.info/api/address', 'https://mempool.space/api/address'],
  },
};

// Block explorers that expose the Blockscout v2 API used for token balances
// and token transfers. Chains without an entry are not scanned for tokens.
export const BLOCKSCOUT = {
  ethereum: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  optimism: 'https://optimism.blockscout.com',
  polygon: 'https://polygon.blockscout.com',
  gnosis: 'https://gnosis.blockscout.com',
  linea: 'https://linea.blockscout.com',
  scroll: 'https://scroll.blockscout.com',
  zksync: 'https://zksync.blockscout.com',
  mantle: 'https://mantle.blockscout.com',
  celo: 'https://celo.blockscout.com',
  moonbeam: 'https://moonbeam.blockscout.com',
  moonriver: 'https://moonriver.blockscout.com',
  metis: 'https://metis.blockscout.com',
  blast: 'https://blast.blockscout.com',
  mode: 'https://explorer.mode.network',
  taiko: 'https://taikoscan.io',
  berachain: 'https://berascan.com',
  ink: 'https://explorer.inkonchain.com',
  sonic: 'https://sonicscan.org',
  robinhood: 'https://robinhoodchain.blockscout.com',
};

/**
 * The chain list as the browser is allowed to see it.
 * Endpoint URLs stay on the server: they are infrastructure, not product.
 */
export function chainCatalog() {
  return Object.entries(CHAINS).map(([id, chain]) => ({
    id,
    name: chain.name,
    symbol: chain.symbol,
    kind: chain.kind,
  }));
}

/** Validate a public address for a chain. Returns an error message or null. */
export function validateAddress(chain, address) {
  if (!CHAINS[chain]) return 'Unsupported chain';
  if (typeof address !== 'string' || address.length > 128 || address.trim() !== address) return 'Invalid address';
  if (CHAINS[chain].kind === 'evm' && !EVM.test(address)) return 'Invalid EVM address';
  if (chain === 'solana' && !SOL.test(address)) return 'Invalid Solana address';
  if (chain === 'bitcoin' && !BTC.test(address)) return 'Invalid Bitcoin address';
  return null;
}

/** EVM addresses are case insensitive - store them lower cased. */
export function normalizeAddress(chain, address) {
  if (typeof address !== 'string') return address;
  return CHAINS[chain]?.kind === 'evm' ? address.toLowerCase() : address;
}

function hasKeyMaterial(value) {
  const bare = value.replace(/^0x/i, '');
  // 32 byte private key (EVM, Bitcoin) or 64 byte key (Solana) as hex.
  if (/^[0-9a-f]{64}$/i.test(bare)) return true;
  if (/^[0-9a-f]{128}$/i.test(bare)) return true;
  // Solana keypair secret: 87-88 base58 characters.
  if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(value)) return true;
  return false;
}

/**
 * Does this value look like a seed phrase or a private key?
 * Used for address fields, where any whitespace is already suspicious.
 */
export function looksLikeSecret(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (/\s/.test(v)) return true;
  if (hasKeyMaterial(v)) return true;
  return v.split(/\s+/).length >= 12;
}

/**
 * Same check for free text fields such as a wallet label, where spaces are
 * normal. Only key material or a full word list is refused.
 */
export function looksLikeSecretPhrase(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v) return false;
  if (hasKeyMaterial(v)) return true;
  return v.split(/\s+/).length >= 12;
}
