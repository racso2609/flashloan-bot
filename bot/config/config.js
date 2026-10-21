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

  // DEX factory addresses (for pool-liquidity validation)
  DEX_FACTORIES: chain.factories || {},
  
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
      // NOTE (fork-test findings):
      // - Native USDC/WETH Sushi on Arbitrum is very thin: 1000 USDC -> 0.193 WETH.
      // - USDC.e (bridged) pools are deep on both UniV3/Sushi but round-trip
      //   edge is currently negative at all sizes (edge maxes at smallest loan
      //   but still < fees+premium; spreads change over time).
      // - Base native USDC/WETH has no usable UniV3 pool (use Aerodrome instead).
      USDC: '50000000',      // 50 USDC (thin native pools; reduce if needed)
      USDC_E: '10000000',    // 10 USDC.e (deep; minimize size due to fee erosion)
      WETH: '100000000000000000', // 0.1 WETH
      DAI: '1000000000000000000',  // 1000 DAI
    },
    
    DEFAULT_FLASHLOAN: process.env.FLASHLOAN_AMOUNT || '10000000', // 10 USDC.e
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

  // Liquidity validation: check the pool actually holds liquidity before
  // trusting a quote. A quoter can return a plausible value for a pool with no
  // initialized liquidity; the pool's own state is authoritative.
  UNISWAP_V3_FACTORY_ABI: [
    'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
  ],
  UNISWAP_V3_POOL_ABI: [
    'function liquidity() view returns (uint128)',
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
  ],
  UNISWAP_V2_FACTORY_ABI: [
    'function getPair(address tokenA, address tokenB) view returns (address pair)',
  ],
  UNISWAP_V2_PAIR_ABI: [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
  ],
  
  // Explorer URL for logging
  explorer: chain.explorer,
};

module.exports = config;
