// Configuration for the flashloan arbitrage bot
// Default configuration for Arbitrum One
require("dotenv").config();

// Network configuration
const ARBITRUM_CHAIN_ID = 42161;

module.exports = {
  // Network info
  NETWORK: "arbitrum-one",
  CHAIN_ID: ARBITRUM_CHAIN_ID,

  // RPC endpoint (use Alchemy, Infura, or local node)
  RPC_URL:
    process.env.ARBITRUM_RPC_URL ||
    "https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY",

  // Private key for signing transactions (NEVER commit this!)
  PRIVATE_KEY: process.env.PRIVATE_KEY || "0xYOUR_PRIVATE_KEY",

  // Your deployed Flashloan contract address
  FLASHLOAN_CONTRACT:
    process.env.FLASHLOAN_CONTRACT || "0xYOUR_CONTRACT_ADDRESS",

  // Aave V3 addresses on Arbitrum One
  AAVE_V3: {
    POOL: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    PROVIDER: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
  },

  // DEX Router addresses on Arbitrum One
  DEX_ROUTERS: {
    UNISWAP_V3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    SUSHISWAP: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    CAMELOT: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d",
    UNISWAP_V3_QUOTER: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
  },

  // Token addresses on Arbitrum One
  TOKENS: {
    WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC
    USDC_E: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", // Bridged USDC
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    ARB: "0x912CE59144191C1204E64559FE8253a0e49E6548",
    LINK: "0xf97f4df7a5759793cc5f7946d98b93fa65e77761",
    GMX: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
    MAGIC: "0x539bdE0d7Dbd336b79148AA742883198BBF60342",
    GRAIL: "0x3d9907F9a368ad07398Cd9123b0B3F9b39907d14",
  },

  // Token decimals
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
    MAGIC: 18,
    GRAIL: 18,
  },

  // Trading pairs to monitor [tokenA, tokenB]
  // MORE PAIRS = MORE OPPORTUNITIES
  TRADING_PAIRS: [
    // Main pairs
    ["WETH", "USDC"],
    ["WETH", "USDC_E"], // USDC.e often has price differences!
    ["WETH", "USDT"],
    ["WETH", "DAI"],
    ["WBTC", "USDC"],
    ["WBTC", "WETH"],

    // Stablecoin pairs (good for triangular arb)
    ["USDC", "USDC_E"], // Same dollar, different tokens!
    ["USDC", "USDT"],
    ["USDC", "DAI"],
    ["USDC_E", "USDT"],

    // Arbitrum ecosystem
    ["ARB", "USDC"],
    ["ARB", "WETH"],
    ["ARB", "USDC_E"],

    // DeFi tokens
    ["GMX", "USDC"],
    ["GMX", "WETH"],
    ["LINK", "USDC"],
    ["LINK", "WETH"],
    ["MAGIC", "USDC"],
    ["MAGIC", "WETH"],
    ["GRAIL", "USDC"],
    ["GRAIL", "WETH"],
  ],

  // DEX pairs to compare - ADDING CAMELOT
  DEX_PAIRS: [
    ["SUSHISWAP", "UNISWAP_V3"],
    ["UNISWAP_V3", "SUSHISWAP"],
    ["CAMELOT", "UNISWAP_V3"],
    ["UNISWAP_V3", "CAMELOT"],
    ["CAMELOT", "SUSHISWAP"],
    ["SUSHISWAP", "CAMELOT"],
  ],

  // Triangular arbitrage paths [tokenA, tokenB, tokenC, backToTokenA]
  // Format: [firstToken, middleToken1, middleToken2, backToFirst]
  TRIANGULAR_PATHS: [
    // USDC routes
    ["USDC", "WETH", "USDC_E", "USDC"],
    ["USDC", "WETH", "USDT", "USDC"],
    ["USDC", "WBTC", "WETH", "USDC"],
    ["USDC", "ARB", "WETH", "USDC"],
    ["USDC_E", "WETH", "USDC", "USDC_E"],
    ["USDC", "WETH", "DAI", "USDC"],

    // WETH routes
    ["WETH", "USDC", "AR", "WETH"],
    ["WETH", "USDC_E", "USDT", "WETH"],
    ["WETH", "WBTC", "USDC", "WETH"],
  ],

  // Bot settings - OPTIMIZED FOR MORE OPPORTUNITIES
  SETTINGS: {
    // Minimum profit in USD - LOWER = MORE OPPORTUNITIES
    MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD || "1"),

    // Maximum gas price in Gwei
    MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI || "0.5"),

    // Flashloan amounts for different tokens
    FLASHLOAN_AMOUNTS: {
      USDC: "1000000000", // 1000 USDC
      USDC_E: "1000000000", // 1000 USDC.e
      USDT: "1000000000", // 1000 USDT
      WETH: "1000000000000000000", // 1 WETH
      WBTC: "10000000", // 0.1 WBTC
      ARB: "1000000000000000000000", // 1000 ARB
    },

    // Default flashloan amount (USDC)
    DEFAULT_FLASHLOAN: process.env.FLASHLOAN_AMOUNT || "1000000000",

    // Slippage tolerance in basis points (100 = 1%)
    SLIPPAGE_BPS: 50, // Tighter slippage = better profits

    // Polling interval - FASTER = MORE OPPORTUNITIES
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || "500"),

    // Dry run mode
    DRY_RUN: process.env.DRY_RUN === "true",

    // Log level
    LOG_LEVEL: process.env.LOG_LEVEL || "warn",

    // Enable triangular arbitrage
    ENABLE_TRIANGULAR: true,
  },

  // Flashloan ABI
  FLASHLOAN_ABI: [
    "function loan(address asset, uint256 amount, bytes calldata params) external",
    "function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool)",
    "function rescueToken(address token, uint256 amount, address to) external",
    "function owner() view returns (address)",
    "event LoanRequested(address indexed asset, uint256 amount)",
    "event OperationExecuted(address indexed asset, uint256 amount, uint256 premium, uint256 profit)",
  ],

  // ERC20 ABI
  ERC20_ABI: [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ],

  // Uniswap V2-compatible Router ABI (for SushiSwap, Camelot)
  UNISWAP_V2_ROUTER_ABI: [
    "function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts)",
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  ],

  // Uniswap V3 Quoter ABI
  UNISWAP_V3_QUOTER_ABI: [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
  ],
};
