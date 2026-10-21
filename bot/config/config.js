// Default configuration - loads from chains.js based on CHAIN env var
require('dotenv').config();

const { getChainConfig } = require('../src/chains');

// Get chain from environment or command line
const chainName = process.env.CHAIN || process.argv[2] || 'arbitrum';
const chain = getChainConfig(chainName);

// Build the config object
const config = {
  // Network info
  NETWORK: chain.chainId,
  NAME: chain.name,
  CHAIN_ID: chain.chainId,
  CHAIN_NAME: chain.chainId === 42161 ? 'arbitrum' : 'base',
  
  // RPC endpoint
  RPC_URL: process.env[chain.rpcEnv] || chain.defaultRpc,
  
  // WebSocket endpoint (optional, preferred for block subscriptions)
  WSS_URL: (chain.wssEnv && process.env[chain.wssEnv]) || null,
  
  // Private key
  PRIVATE_KEY: process.env.PRIVATE_KEY || '0xYOUR_PRIVATE_KEY',
  
  // Contract address (from env or must be set)
  FLASHLOAN_CONTRACT: process.env.FLASHLOAN_CONTRACT || null,
  
  // Aave V3 addresses
  AAVE_V3: chain.aave,
  
  // DEX Router addresses
  DEX_ROUTERS: chain.dexes,
  
  // Token addresses
  TOKENS: chain.tokens,
  
  // Token decimals
  DECIMALS: chain.decimals,
  
  // Trading pairs to monitor
  TRADING_PAIRS: chain.tradingPairs,
  
  // DEX pairs to compare
  DEX_PAIRS: chain.dexPairs,
  
  // Triangular paths (chain-specific)
  TRIANGULAR_PATHS: chain.chainId === 42161 ? [
    ['USDC', 'WETH', 'USDC_E', 'USDC'],
    ['USDC', 'WETH', 'USDT', 'USDC'],
    ['USDC', 'DAI', 'WETH', 'USDC'],
  ] : [
    ['USDC', 'WETH', 'DAI', 'USDC'],
    ['USDC', 'WETH', 'USDT', 'USDC'],
    ['USDC', 'DAI', 'WETH', 'USDC'],
    ['WETH', 'USDC', 'cbETH', 'WETH'],
  ],
  
  // Bot settings
  SETTINGS: {
    MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD || '0.5'),
    MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI || '1'),
    
    FLASHLOAN_AMOUNTS: {
      USDC: '1000000000',          // 1000 USDC
      USDC_E: '1000000000',        // 1000 USDC.e (Arbitrum only)
      WETH: '1000000000000000000', // 1 WETH
      DAI: '1000000000000000000',  // 1000 DAI
    },
    
    DEFAULT_FLASHLOAN: process.env.FLASHLOAN_AMOUNT || '1000000000',
    SLIPPAGE_BPS: 50,
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '500'),
    DRY_RUN: process.env.DRY_RUN !== 'false',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    ENABLE_TRIANGULAR: true,
  },
  
  // ABIs (minimal)
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
  
  UNISWAP_V3_QUOTER_V2_ABI: [
    'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 fee, uint256 amountIn, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
    'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList)',
  ],
  
  // Explorer URL for logging
  explorer: chain.explorer,
};

module.exports = config;
