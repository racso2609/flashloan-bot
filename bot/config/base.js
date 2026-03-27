// Configuration for the flashloan arbitrage bot - BASE NETWORK
require('dotenv').config();

const BASE_CHAIN_ID = 8453;

module.exports = {
  // Network info
  NETWORK: 'base',
  CHAIN_ID: BASE_CHAIN_ID,
  
  // RPC endpoint
  RPC_URL: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  
  // Private key
  PRIVATE_KEY: process.env.PRIVATE_KEY || '0xYOUR_PRIVATE_KEY',
  
  // Deployed Flashloan contract address
  FLASHLOAN_CONTRACT: process.env.FLASHLOAN_CONTRACT || '0xYOUR_CONTRACT_ADDRESS',
  
  // Aave V3 addresses on Base
  AAVE_V3: {
    POOL: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    PROVIDER: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
  },
  
  // DEX Router addresses on Base
  DEX_ROUTERS: {
    AERODROME: '0x6Cb442acF35158D5eDa88fe602221b67B400Be3E',
    SUSHISWAP: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
    UNISWAP_V3: '0x2626664c2603336E57B271c5C0b26F421741e481',
    UNISWAP_V3_QUOTER: '0x3d4e44B1d0040FbA06427a587790f548044dE79A',
  },
  
  // Token addresses on Base
  TOKENS: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589FCD6eDb6E08f4c7C32D4f71B54bdA02913',  // Native USDC on Base
    DAI: '0x50c5725949A6F0c72E6C4a641F24519985316338',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    AERO: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    VELO: '0x9560e8358e835558269694Ed9eC9F6F97aFf6aC5',
  },
  
  // Token decimals
  DECIMALS: {
    WETH: 18,
    USDC: 6,
    DAI: 18,
    USDT: 6,
    cbETH: 18,
    cbBTC: 8,
    AERO: 18,
    VELO: 18,
  },
  
  // Trading pairs to monitor
  TRADING_PAIRS: [
    ['WETH', 'USDC'],
    ['WETH', 'DAI'],
    ['WETH', 'USDT'],
    ['cbETH', 'WETH'],
    ['cbETH', 'USDC'],
    ['cbBTC', 'WETH'],
    ['cbBTC', 'USDC'],
    ['USDC', 'DAI'],
    ['USDC', 'USDT'],
    ['AERO', 'WETH'],
    ['AERO', 'USDC'],
  ],
  
  // DEX pairs to compare
  DEX_PAIRS: [
    ['SUSHISWAP', 'AERODROME'],
    ['AERODROME', 'SUSHISWAP'],
    ['UNISWAP_V3', 'AERODROME'],
    ['AERODROME', 'UNISWAP_V3'],
  ],
  
  // Bot settings
  SETTINGS: {
    MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD || '1'),
    MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI || '0.5'),
    
    FLASHLOAN_AMOUNTS: {
      USDC: '1000000000',          // 1000 USDC
      WETH: '1000000000000000000', // 1 WETH
      DAI: '1000000000000000000',  // 1000 DAI
    },
    
    DEFAULT_FLASHLOAN: process.env.FLASHLOAN_AMOUNT || '1000000000',
    SLIPPAGE_BPS: 50,
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '500'),
    DRY_RUN: process.env.DRY_RUN === 'true',
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    ENABLE_TRIANGULAR: true,
  },
  
  // ABIs
  FLASHLOAN_ABI: [
    'function loan(address asset, uint256 amount, bytes calldata params) external',
    'function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool)',
    'function rescueToken(address token, uint256 amount, address to) external',
    'event LoanRequested(address indexed asset, uint256 amount)',
    'event OperationExecuted(address indexed asset, uint256 amount, uint256 premium, uint256 profit)',
  ],
  
  ERC20_ABI: [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
  ],
  
  UNISWAP_V2_ROUTER_ABI: [
    'function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts)',
  ],
  
  UNISWAP_V3_QUOTER_ABI: [
    'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
  ],
};
