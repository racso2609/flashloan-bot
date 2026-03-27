// Multi-chain configuration for Arbitrum and Base
require('dotenv').config();

const chains = {
  // ============================================
  // ARBITRUM ONE
  // ============================================
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcEnv: 'ARBITRUM_RPC_URL',
    defaultRpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    
    aave: {
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      provider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
    },
    
    dexes: {
      SUSHISWAP: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      CAMELOT: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
      UNISWAP_V3: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      UNISWAP_V3_QUOTER: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    },
    
    tokens: {
      WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      USDC_E: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
      USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
      WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
      ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      LINK: '0xf97f4df7a5759793cc5f7946d98b93fa65e77761',
      GMX: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',
    },
    
    decimals: {
      WETH: 18, USDC: 6, USDC_E: 6, USDT: 6, DAI: 18,
      WBTC: 8, ARB: 18, LINK: 18, GMX: 18,
    },
    
    tradingPairs: [
      ['WETH', 'USDC'], ['WETH', 'USDC_E'], ['WETH', 'USDT'], ['WETH', 'DAI'],
      ['USDC', 'USDC_E'], ['USDC', 'USDT'], ['WBTC', 'USDC'], ['ARB', 'USDC'],
    ],
    
    dexPairs: [
      ['SUSHISWAP', 'CAMELOT'], ['CAMELOT', 'SUSHISWAP'],
    ],
  },
  
  // ============================================
  // BASE
  // ============================================
  base: {
    name: 'Base',
    chainId: 8453,
    rpcEnv: 'BASE_RPC_URL',
    defaultRpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    
    aave: {
      pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
      provider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
    },
    
    dexes: {
      AERODROME: '0x6Cb442acF35158D5eDa88fe602221b67B400Be3E',
      SUSHISWAP: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
      UNISWAP_V3: '0x2626664c2603336E57B271c5C0b26F421741e481',
      UNISWAP_V3_QUOTER: '0x3d4e44B1d0040FbA06427a587790f548044dE79A',
    },
    
    tokens: {
      WETH: '0x4200000000000000000000000000000000000006',
      USDC: '0x833589FCD6eDb6E08f4c7C32D4f71B54bdA02913',
      DAI: '0x50c5725949A6F0c72E6C4a641F24519985316338',
      USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
      cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      AERO: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    },
    
    decimals: {
      WETH: 18, USDC: 6, DAI: 18, USDT: 6,
      cbETH: 18, cbBTC: 8, AERO: 18,
    },
    
    tradingPairs: [
      ['WETH', 'USDC'], ['WETH', 'DAI'], ['WETH', 'USDT'],
      ['cbETH', 'WETH'], ['cbETH', 'USDC'], ['cbBTC', 'USDC'],
      ['USDC', 'DAI'], ['USDC', 'USDT'], ['AERO', 'USDC'],
    ],
    
    dexPairs: [
      ['SUSHISWAP', 'AERODROME'], ['AERODROME', 'SUSHISWAP'],
      ['UNISWAP_V3', 'AERODROME'], ['AERODROME', 'UNISWAP_V3'],
    ],
  },
};

/**
 * Get chain configuration by name
 */
function getChainConfig(chainName) {
  const chain = chains[chainName.toLowerCase()];
  if (!chain) {
    throw new Error(`Unknown chain: ${chainName}. Available: ${Object.keys(chains).join(', ')}`);
  }
  return chain;
}

/**
 * Get bot configuration for a specific chain
 */
function getBotConfig(chainName, overrides = {}) {
  const chain = getChainConfig(chainName);
  
  return {
    // Network info
    NETWORK: chain.chainId,
    CHAIN_NAME: chain.name,
    CHAIN_ID: chain.chainId,
    
    // RPC
    RPC_URL: process.env[chain.rpcEnv] || chain.defaultRpc,
    
    // Wallet
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    
    // Contract (override with env var)
    FLASHLOAN_CONTRACT: process.env.FLASHLOAN_CONTRACT || null,
    
    // Aave
    AAVE_V3: chain.aave,
    
    // DEX routers
    DEX_ROUTERS: chain.dexes,
    
    // Tokens
    TOKENS: chain.tokens,
    DECIMALS: chain.decimals,
    
    // Trading config
    TRADING_PAIRS: chain.tradingPairs,
    DEX_PAIRS: chain.dexPairs,
    
    // Bot settings
    SETTINGS: {
      MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD || '0.5'),
      MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI || '1'),
      DEFAULT_FLASHLOAN: process.env.FLASHLOAN_AMOUNT || '1000000000',
      SLIPPAGE_BPS: 50,
      POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '500'),
      DRY_RUN: process.env.DRY_RUN !== 'false',
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
      ...overrides,
    },
    
    // Explorer
    explorer: chain.explorer,
  };
}

/**
 * List all available chains
 */
function listChains() {
  return Object.keys(chains).map(key => ({
    name: chains[key].name,
    chainId: chains[key].chainId,
  }));
}

module.exports = {
  chains,
  getChainConfig,
  getBotConfig,
  listChains,
};
