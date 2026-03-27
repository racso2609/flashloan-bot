// Configuration for the flashloan arbitrage bot
require('dotenv').config();

module.exports = {
  // Ethereum RPC endpoint (use Alchemy, Infura, or local node)
  RPC_URL: process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  
  // Private key for signing transactions (NEVER commit this!)
  PRIVATE_KEY: process.env.PRIVATE_KEY || '0xYOUR_PRIVATE_KEY',
  
  // Your deployed Flashloan contract address
  FLASHLOAN_CONTRACT: process.env.FLASHLOAN_CONTRACT || '0xYOUR_CONTRACT_ADDRESS',
  
  // Aave V3 addresses (Mainnet)
  AAVE_V3: {
    POOL: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    PROVIDER: '0x2F39D218133AFAb8f2B819B1066Fc7E75012e9E9',
  },
  
  // DEX Router addresses (Mainnet)
  DEX_ROUTERS: {
    UNISWAP_V2: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    UNISWAP_V3: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    SUSHISWAP: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    QUICKSWAP: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // Polygon
  },
  
  // Token addresses (Mainnet)
  TOKENS: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    LINK: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
    UNI: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
  },
  
  // Token decimals
  DECIMALS: {
    WETH: 18,
    USDC: 6,
    USDT: 6,
    DAI: 18,
    WBTC: 8,
    LINK: 18,
    UNI: 18,
  },
  
  // Trading pairs to monitor [tokenA, tokenB]
  TRADING_PAIRS: [
    ['WETH', 'USDC'],
    ['WETH', 'USDT'],
    ['WETH', 'DAI'],
    ['WBTC', 'USDC'],
    ['WBTC', 'WETH'],
    ['LINK', 'USDC'],
    ['UNI', 'USDC'],
  ],
  
  // DEX pairs to compare [DEX1, DEX2]
  DEX_PAIRS: [
    ['UNISWAP_V2', 'SUSHISWAP'],
    ['UNISWAP_V2', 'UNISWAP_V3'],
    ['SUSHISWAP', 'UNISWAP_V3'],
  ],
  
  // Bot settings
  SETTINGS: {
    // Minimum profit in USD to execute a trade
    MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD || '10'),
    
    // Maximum gas price in Gwei to execute trades
    MAX_GAS_PRICE_GWEI: parseFloat(process.env.MAX_GAS_PRICE_GWEI || '50'),
    
    // Flashloan amount (in token units, e.g., 1000 USDC = 1000000000)
    FLASHLOAN_AMOUNT: process.env.FLASHLOAN_AMOUNT || '1000000000', // 1000 USDC
    
    // Slippage tolerance in basis points (100 = 1%)
    SLIPPAGE_BPS: 100,
    
    // Polling interval in milliseconds
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '3000'),
    
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
  
  // Uniswap V2 Pair ABI (for getting reserves)
  UNISWAP_V2_PAIR_ABI: [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
  ],
  
  // Uniswap V2 Factory ABI (for finding pairs)
  UNISWAP_V2_FACTORY_ABI: [
    'function getPair(address tokenA, address tokenB) view returns (address pair)',
    'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
  ],
  // Uniswap V2 Factory address
  UNISWAP_V2_FACTORY: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
};
