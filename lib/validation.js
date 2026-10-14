const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BTC = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/;
export const CHAINS = {
  ethereum:{name:'Ethereum',symbol:'ETH',kind:'evm',rpc:'https://ethereum-rpc.publicnode.com'},
  base:{name:'Base',symbol:'ETH',kind:'evm',rpc:'https://base-rpc.publicnode.com'},
  arbitrum:{name:'Arbitrum One',symbol:'ETH',kind:'evm',rpc:'https://arbitrum-one-rpc.publicnode.com'},
  optimism:{name:'Optimism',symbol:'ETH',kind:'evm',rpc:'https://optimism-rpc.publicnode.com'},
  polygon:{name:'Polygon',symbol:'POL',kind:'evm',rpc:'https://polygon-bor-rpc.publicnode.com'},
  bsc:{name:'BNB Chain',symbol:'BNB',kind:'evm',rpc:'https://bsc-rpc.publicnode.com'},
  avalanche:{name:'Avalanche C-Chain',symbol:'AVAX',kind:'evm',rpc:'https://avalanche-c-chain-rpc.publicnode.com'},
  gnosis:{name:'Gnosis',symbol:'xDAI',kind:'evm',rpc:'https://gnosis-rpc.publicnode.com'},
  linea:{name:'Linea',symbol:'ETH',kind:'evm',rpc:'https://linea-rpc.publicnode.com'},
  scroll:{name:'Scroll',symbol:'ETH',kind:'evm',rpc:'https://scroll-rpc.publicnode.com'},
  zksync:{name:'zkSync Era',symbol:'ETH',kind:'evm',rpc:'https://mainnet.era.zksync.io'},
  mantle:{name:'Mantle',symbol:'MNT',kind:'evm',rpc:'https://rpc.mantle.xyz'},
  celo:{name:'Celo',symbol:'CELO',kind:'evm',rpc:'https://forno.celo.org'},
  cronos:{name:'Cronos',symbol:'CRO',kind:'evm',rpc:'https://evm.cronos.org'},
  opbnb:{name:'opBNB',symbol:'BNB',kind:'evm',rpc:'https://opbnb-mainnet-rpc.bnbchain.org'},
  moonbeam:{name:'Moonbeam',symbol:'GLMR',kind:'evm',rpc:'https://rpc.api.moonbeam.network'},
  moonriver:{name:'Moonriver',symbol:'MOVR',kind:'evm',rpc:'https://rpc.api.moonriver.moonbeam.network'},
  metis:{name:'Metis',symbol:'METIS',kind:'evm',rpc:'https://andromeda.metis.io/?owner=1088'},
  blast:{name:'Blast',symbol:'ETH',kind:'evm',rpc:'https://rpc.blast.io'},
  mode:{name:'Mode',symbol:'ETH',kind:'evm',rpc:'https://mainnet.mode.network'},
  taiko:{name:'Taiko',symbol:'ETH',kind:'evm',rpc:'https://rpc.mainnet.taiko.xyz'},
  sei_evm:{name:'Sei EVM',symbol:'SEI',kind:'evm',rpc:'https://evm-rpc.sei-apis.com'},
  berachain:{name:'Berachain',symbol:'BERA',kind:'evm',rpc:'https://rpc.berachain.com'},
  ink:{name:'Ink',symbol:'ETH',kind:'evm',rpc:'https://rpc-gel.inkonchain.com'},
  sonic:{name:'Sonic',symbol:'S',kind:'evm',rpc:'https://rpc.soniclabs.com'},
  robinhood:{name:'Robinhood Chain',symbol:'ETH',kind:'evm',rpc:'https://rpc.mainnet.chain.robinhood.com',chainId:4663,explorer:'https://robinhoodchain.blockscout.com'},
  solana:{name:'Solana',symbol:'SOL',kind:'solana'},
  bitcoin:{name:'Bitcoin',symbol:'BTC',kind:'bitcoin'}
};
export const BLOCKSCOUT = {
  ethereum:'https://eth.blockscout.com', base:'https://base.blockscout.com', arbitrum:'https://arbitrum.blockscout.com', optimism:'https://optimism.blockscout.com', polygon:'https://polygon.blockscout.com', gnosis:'https://gnosis.blockscout.com', linea:'https://linea.blockscout.com', scroll:'https://scroll.blockscout.com', zksync:'https://zksync.blockscout.com', mantle:'https://mantle.blockscout.com', celo:'https://celo.blockscout.com',
  moonbeam:'https://moonbeam.blockscout.com', moonriver:'https://moonriver.blockscout.com', metis:'https://metis.blockscout.com', blast:'https://blast.blockscout.com', mode:'https://explorer.mode.network', taiko:'https://taikoscan.io', berachain:'https://berascan.com', ink:'https://explorer.inkonchain.com', sonic:'https://sonicscan.org', robinhood:'https://robinhoodchain.blockscout.com'
};
export function validateAddress(chain,address){
  if(!CHAINS[chain]) return 'Unsupported chain';
  if(typeof address!=='string' || address.length>128 || address.trim()!==address) return 'Invalid address';
  if(CHAINS[chain].kind==='evm' && !EVM.test(address)) return 'Invalid EVM address';
  if(chain==='solana' && !SOL.test(address)) return 'Invalid Solana address';
  if(chain==='bitcoin' && !BTC.test(address)) return 'Invalid Bitcoin address';
  return null;
}
export function looksLikeSecret(value){ const words=value.trim().split(/\s+/); if(words.length>=11)return true; const s=value.replace(/^0x/i,''); return s.length===64 && /^[0-9a-f]+$/i.test(s); }
