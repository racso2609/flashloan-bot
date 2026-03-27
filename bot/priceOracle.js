// Price oracle module - fetches prices from different DEXes
const { ethers } = require('ethers');
const config = require('./config');

class PriceOracle {
  constructor(provider) {
    this.provider = provider;
    
    // Initialize router contracts (only for DEXes with valid addresses)
    this.routers = {};
    
    // Add SushiSwap router
    if (config.DEX_ROUTERS.SUSHISWAP) {
      this.routers.SUSHISWAP = new ethers.Contract(
        config.DEX_ROUTERS.SUSHISWAP,
        config.UNISWAP_V2_ROUTER_ABI,
        provider
      );
    }
    
    // Add Camelot router (V2-compatible)
    if (config.DEX_ROUTERS.CAMELOT) {
      this.routers.CAMELOT = new ethers.Contract(
        config.DEX_ROUTERS.CAMELOT,
        config.UNISWAP_V2_ROUTER_ABI,
        provider
      );
    }
    
    // V3 quoter for Uniswap V3
    this.v3Quoter = new ethers.Contract(
      config.DEX_ROUTERS.UNISWAP_V3_QUOTER,
      config.UNISWAP_V3_QUOTER_ABI,
      provider
    );
  }

  /**
   * Get price from V2-compatible DEX (SushiSwap, Camelot)
   */
  async getPriceV2(dexName, tokenIn, tokenOut, amountIn) {
    try {
      const router = this.routers[dexName];
      if (!router) return { amountOut: 0n, price: 0 };
      
      // Skip if same token
      if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
        return { amountOut: 0n, price: 0 };
      }
      
      const path = [tokenIn, tokenOut];
      const amounts = await router.getAmountsOut(amountIn, path);
      const amountOut = amounts[amounts.length - 1];
      
      const tokenInDecimals = await this.getTokenDecimals(tokenIn);
      const tokenOutDecimals = await this.getTokenDecimals(tokenOut);
      
      const price = Number(amountOut) / Number(amountIn) * 
        (10 ** tokenInDecimals) / (10 ** tokenOutDecimals);
      
      return { amountOut, price };
    } catch (error) {
      return { amountOut: 0n, price: 0 };
    }
  }

  /**
   * Get price from Uniswap V3
   */
  async getPriceV3(tokenIn, tokenOut, fee, amountIn) {
    try {
      // Skip if same token
      if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
        return { amountOut: 0n, price: 0 };
      }
      
      const amountOut = await this.v3Quoter.quoteExactInputSingle.staticCall(
        tokenIn,
        tokenOut,
        fee,
        amountIn,
        0
      );
      
      const tokenInDecimals = await this.getTokenDecimals(tokenIn);
      const tokenOutDecimals = await this.getTokenDecimals(tokenOut);
      
      const price = Number(amountOut) / Number(amountIn) * 
        (10 ** tokenInDecimals) / (10 ** tokenOutDecimals);
      
      return { amountOut, price };
    } catch (error) {
      return { amountOut: 0n, price: 0 };
    }
  }

  /**
   * Get price through a path (for triangular arbitrage)
   */
  async getPriceThroughPath(path, amountIn) {
    let currentAmount = amountIn;
    
    for (let i = 0; i < path.length - 1; i++) {
      const tokenIn = path[i];
      const tokenOut = path[i + 1];
      
      // Try each DEX and take the best price
      let bestAmount = 0n;
      
      // Try V2 DEXes
      for (const dexName of Object.keys(this.routers)) {
        const result = await this.getPriceV2(dexName, tokenIn, tokenOut, currentAmount);
        if (result.amountOut > bestAmount) {
          bestAmount = result.amountOut;
        }
      }
      
      // Try V3 with different fees
      for (const fee of [100, 500, 3000, 10000]) {
        const result = await this.getPriceV3(tokenIn, tokenOut, fee, currentAmount);
        if (result.amountOut > bestAmount) {
          bestAmount = result.amountOut;
        }
      }
      
      if (bestAmount === 0n) {
        return { amountOut: 0n, profitable: false };
      }
      
      currentAmount = bestAmount;
    }
    
    return { amountOut: currentAmount, profitable: true };
  }

  /**
   * Get prices from all DEXes for a token pair
   */
  async getPricesFromAllDexes(tokenA, tokenB, amountIn) {
    const prices = {};
    
    // Try V2 DEXes
    for (const dexName of Object.keys(this.routers)) {
      const result = await this.getPriceV2(dexName, tokenA, tokenB, amountIn);
      if (result.amountOut > 0n) {
        prices[dexName] = result;
      }
    }
    
    // Try V3 with different fees
    for (const fee of [100, 500, 3000, 10000]) {
      const result = await this.getPriceV3(tokenA, tokenB, fee, amountIn);
      if (result.amountOut > 0n) {
        prices[`UNISWAP_V3_${fee}`] = result;
      }
    }
    
    return prices;
  }

  /**
   * Get the best price for a token pair
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
    
    try {
      const token = new ethers.Contract(tokenAddress, config.ERC20_ABI, this.provider);
      const decimals = await token.decimals();
      this._decimalsCache[addr] = decimals;
      return decimals;
    } catch (error) {
      return 18; // Default to 18 decimals
    }
  }
}

module.exports = PriceOracle;
