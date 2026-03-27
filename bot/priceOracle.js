// Price oracle module - fetches prices from different DEXes
const { ethers } = require('ethers');
const config = require('./config');

// Uniswap V2 Router ABI (minimal for getting amounts out)
const ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts)',
];

// Uniswap V3 Quoter ABI (for V3 price quotes)
const QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
];

class PriceOracle {
  constructor(provider) {
    this.provider = provider;
    
    // Initialize router contracts (only for DEXes with valid addresses)
    this.routers = {};
    
    // Add Uniswap V2 router if available
    if (config.DEX_ROUTERS.UNISWAP_V2) {
      this.routers.UNISWAP_V2 = new ethers.Contract(
        config.DEX_ROUTERS.UNISWAP_V2,
        ROUTER_ABI,
        provider
      );
    }
    
    // Add SushiSwap router if available
    if (config.DEX_ROUTERS.SUSHISWAP) {
      this.routers.SUSHISWAP = new ethers.Contract(
        config.DEX_ROUTERS.SUSHISWAP,
        ROUTER_ABI,
        provider
      );
    }
    
    // V3 quoter (use from config or default)
    const quoterAddress = config.DEX_ROUTERS.UNISWAP_V3_QUOTER || 
                          '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
    
    this.v3Quoter = new ethers.Contract(
      quoterAddress,
      QUOTER_ABI,
      provider
    );
  }

  /**
   * Get price from Uniswap V2-compatible DEX
   * @param {string} dexName - DEX name (UNISWAP_V2, SUSHISWAP)
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @param {bigint} amountIn - Input amount in token units
   * @returns {Promise<{amountOut: bigint, price: number}>}
   */
  async getPriceV2(dexName, tokenIn, tokenOut, amountIn) {
    try {
      const router = this.routers[dexName];
      if (!router) {
        console.debug(`DEX ${dexName} not available on this network`);
        return { amountOut: 0n, price: 0 };
      }
      
      const path = [tokenIn, tokenOut];
      const amounts = await router.getAmountsOut(amountIn, path);
      const amountOut = amounts[amounts.length - 1];
      
      // Calculate price (amountOut / amountIn, adjusted for decimals)
      const tokenInDecimals = await this.getTokenDecimals(tokenIn);
      const tokenOutDecimals = await this.getTokenDecimals(tokenOut);
      
      const price = Number(amountOut) / Number(amountIn) * 
        (10 ** tokenInDecimals) / (10 ** tokenOutDecimals);
      
      return { amountOut, price };
    } catch (error) {
      console.error(`Error getting V2 price from ${dexName}:`, error.message);
      return { amountOut: 0n, price: 0 };
    }
  }

  /**
   * Get price from Uniswap V3
   * @param {string} tokenIn - Input token address
   * @param {string} tokenOut - Output token address
   * @param {number} fee - Pool fee tier (500, 3000, 10000)
   * @param {bigint} amountIn - Input amount in token units
   * @returns {Promise<{amountOut: bigint, price: number}>}
   */
  async getPriceV3(tokenIn, tokenOut, fee, amountIn) {
    try {
      const amountOut = await this.v3Quoter.quoteExactInputSingle.staticCall(
        tokenIn,
        tokenOut,
        fee,
        amountIn,
        0 // No price limit
      );
      
      const tokenInDecimals = await this.getTokenDecimals(tokenIn);
      const tokenOutDecimals = await this.getTokenDecimals(tokenOut);
      
      const price = Number(amountOut) / Number(amountIn) * 
        (10 ** tokenInDecimals) / (10 ** tokenOutDecimals);
      
      return { amountOut, price };
    } catch (error) {
      console.error(`Error getting V3 price:`, error.message);
      return { amountOut: 0n, price: 0 };
    }
  }

  /**
   * Get prices from multiple DEXes for a token pair
   * @param {string} tokenA - First token address
   * @param {string} tokenB - Second token address
   * @param {bigint} amountIn - Input amount
   * @returns {Promise<Object>} Prices from each DEX
   */
  async getPricesFromAllDexes(tokenA, tokenB, amountIn) {
    const prices = {};
    
    // Get V2 prices (Uniswap V2, SushiSwap) - only for available routers
    for (const dexName of Object.keys(this.routers)) {
      const result = await this.getPriceV2(dexName, tokenA, tokenB, amountIn);
      if (result.amountOut > 0n) {
        prices[dexName] = result;
      }
    }
    
    // Get V3 prices with different fee tiers
    const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
    for (const fee of feeTiers) {
      const result = await this.getPriceV3(tokenA, tokenB, fee, amountIn);
      if (result.amountOut > 0n) {
        prices[`UNISWAP_V3_${fee}`] = result;
      }
    }
    
    return prices;
  }

  /**
   * Get the best price for a token pair across all DEXes
   * @param {string} tokenA - First token address
   * @param {string} tokenB - Second token address
   * @param {bigint} amountIn - Input amount
   * @returns {Promise<{dex: string, amountOut: bigint, price: number}>}
   */
  async getBestPrice(tokenA, tokenB, amountIn) {
    const prices = await this.getPricesFromAllDexes(tokenA, tokenB, amountIn);
    
    let bestResult = { dex: null, amountOut: 0n, price: 0 };
    
    for (const [dex, result] of Object.entries(prices)) {
      if (result.amountOut > bestResult.amountOut) {
        bestResult = { dex, ...result };
      }
    }
    
    return bestResult;
  }

  /**
   * Get the worst price for a token pair across all DEXes
   * @param {string} tokenA - First token address
   * @param {string} tokenB - Second token address
   * @param {bigint} amountIn - Input amount
   * @returns {Promise<{dex: string, amountOut: bigint, price: number}>}
   */
  async getWorstPrice(tokenA, tokenB, amountIn) {
    const prices = await this.getPricesFromAllDexes(tokenA, tokenB, amountIn);
    
    let worstResult = { dex: null, amountOut: ethers.MaxUint256, price: Infinity };
    
    for (const [dex, result] of Object.entries(prices)) {
      if (result.amountOut > 0 && result.amountOut < worstResult.amountOut) {
        worstResult = { dex, ...result };
      }
    }
    
    return worstResult;
  }

  /**
   * Cache for token decimals
   */
  _decimalsCache = {};
  
  /**
   * Get token decimals (cached)
   */
  async getTokenDecimals(tokenAddress) {
    const addr = tokenAddress.toLowerCase();
    if (this._decimalsCache[addr]) {
      return this._decimalsCache[addr];
    }
    
    const token = new ethers.Contract(tokenAddress, config.ERC20_ABI, this.provider);
    const decimals = await token.decimals();
    this._decimalsCache[addr] = decimals;
    return decimals;
  }
}

module.exports = PriceOracle;
