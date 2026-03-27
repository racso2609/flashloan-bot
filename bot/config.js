// Configuration for the flashloan arbitrage bot
// Default configuration for Arbitrum One
require('dotenv').config();

// Network configuration
const ARBITRUM_CHAIN_ID = 42161;

module.exports = {
  // Network info
  NETWORK: 'arbitrum-one',
  CHAIN_ID: ARBITRUM_CHAIN_ID,
  
  // RPC endpoint (use Alchemy, Infura, or local node)
  RPC_URL: process.env.ARBITRUM_RPC_URL || 'https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  
  // Private key for signing transactions (NEVER commit this!)
  PRIVATE_KEY: process.env.PRIVATE_KEY || '0xYOUR_PRIVATE_KEY',
  
  // Your deployed Flashloan contract address
  FLASHLOAN_CONTRACT: process.env.FLASHLOAN_CONTRACT || '0xYOUR_CONTRACT_ADDRESS',
  
  // Aave V3 addresses on Arbitrum One
  AAVE_V3: {
    POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    PROVIDER: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  },
  
  // DEX Router addresses on Arbitrum One
  DEX_ROUTERS: {
    UNISWAP_V2: null, // Not available on Arbitrum
    UNISWAP_V3: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    SUSHISWAP: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    UNISWAP_V3_QUOTER: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  },
  
  // Token addresses on Arbitrum One
  TOKENS: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // Native USDC
    USDC_E: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // Bridged USDC
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    LINK: '0xf97f4df7a5759793cc5f7946d98b93fa65e77761',
    GMX: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',
  },
  
  // Token decimals (same across chains)
  DECIMALS: {
    WETH: 18,
    USDC: 6,
    USDC_E: 6,
    USDT: 6,
    DAI: 18,
    WBTC: 8,
    ARB: 18,
    LINK: 18,
    GMX: 18,
  },
  
  // Trading pairs to monitor [tokenA, tokenB]
  // Format: [tokenSymbol, tokenSymbol]
  TRADING_PAIRS: [
    ['WETH', 'USDC'],
    ['WETH', 'USDC_E'],
    ['WETH', 'USDT'],
    ['WETH', 'DAI'],
    ['WBTC', 'USDC'],
    ['WBTC', 'WETH'],
    ['ARB', 'USDC'],
    ['ARB', 'WETH'],
    ['LINK', 'USDC'],
    ['LINK', 'WETH'],
    ['GMX', 'USDC'],
  ],
  
  // DEX pairs to compare [DEX1, DEX2]
  // Note: Uniswap V2 is not available on Arbitrum
  DEX_PAIRS: [
    ['SUSHISWAP', 'UNISWAP_V3'],
    ['UNISWAP_V3', 'SUSHISWAP'],
  ],
  
  // Bot settings
  SETTINGS: {
    // Minimum profit in USD to execute a trade
    MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD || '5'),
    
    // Maximum gas price in Gwei to execute trades
    // Arbitrum gas is very cheap (< 0.5 Gwei typically)
    MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI || '0.5'),
    
    // Flashloan amount (in token units)
    // USDC: 6 decimals, so 1000 USDC = 1000000000
    FLASHLOAN_AMOUNTS: {
      USDC: '1000000000',     // 1000 USDC
      USDC_E: '1000000000',   // 1000 USDC.e
      USDT: '1000000000',     // 1000 USDT
      WETH: '1000000000000000000', // 1 WETH
      WBTC: '10000000',       // 0.1 WBTC
    },
    
    // Default flashloan amount (USDC)
    DEFAULT_FLASHLOAN: process.env.FLASHLOAN_AMOUNT || '1000000000',
    
    // Slippage tolerance in basis points (100 = 1%)
    SLIPPAGE_BPS: 100,
    
    // Polling interval in milliseconds
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '2000'),
    
    // Dry run mode (don't execute trades, just log)
    DRY_RUN: process.env.DRY_RUN === 'true',
    
    // Log level: 'debug', 'info', 'warn', 'error'
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  },
  
  // Flashloan ABI (minimal, just what we need)
  FLASHLOAN_ABI: [
    'function loan(address asset, uint256 amount, bytes calldata params) external',
    'function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool)',
    'function rescueToken(address token, uint256 amount, address to) external',
    'function owner() view returns (address)',
    'event LoanRequested(address indexed asset, uint256 amount)',
    'event OperationExecuted(address indexed asset, uint256 amount, uint256 premium, uint256 profit)',
  ],
  
  // ERC20 ABI (minimal)
  ERC20_ABI: [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
  ],
  
  // Uniswap V2-compatible Pair ABI (for SushiSwap reserves)
  UNISWAP_V2_PAIR_ABI: [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
  ],
  
  // Uniswap V3 Quoter ABI (for price quotes)
  UNISWAP_V3_QUOTER_ABI: [
    'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
  ],
  
  // Uniswap V3 Factory (for finding pools)
  UNISWAP_V3_FACTORY: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
};
