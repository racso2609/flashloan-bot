// Price oracle module - fetches prices from different DEXes
const { ethers } = require("ethers");
const config = require("../config/config");
const { LiquidityValidator } = require("./liquidityValidator");

// Helper to normalize address (ensures valid checksum)
function normalizeAddress(address) {
  try {
    // Try checksummed first
    return ethers.getAddress(address);
  } catch {
    // If that fails, use lowercase (for chains like Base that use case-insensitive addresses)
    return address.toLowerCase();
  }
}

class PriceOracle {
  constructor(provider, chainConfig) {
    this.provider = provider;

    // Use chain-specific config if provided, otherwise fallback to default
    const cfg = chainConfig || config;

    // Initialize router contracts (only for DEXes with valid addresses)
    this.routers = {};

    // Add SushiSwap router
    if (cfg.DEX_ROUTERS?.SUSHISWAP) {
      this.routers.SUSHISWAP = new ethers.Contract(
        normalizeAddress(cfg.DEX_ROUTERS.SUSHISWAP),
        config.UNISWAP_V2_ROUTER_ABI,
        provider,
      );
    }

    // Add Camelot router (Arbitrum V2-compatible)
    if (cfg.DEX_ROUTERS?.CAMELOT) {
      this.routers.CAMELOT = new ethers.Contract(
        normalizeAddress(cfg.DEX_ROUTERS.CAMELOT),
        config.UNISWAP_V2_ROUTER_ABI,
        provider,
      );
    }

    // Add Velodrome router (Base)
    if (cfg.DEX_ROUTERS?.VELODROME) {
      this.routers.VELODROME = new ethers.Contract(
        normalizeAddress(cfg.DEX_ROUTERS.VELODROME),
        config.UNISWAP_V2_ROUTER_ABI, // Velodrome supports V2-style getAmountsOut
        provider,
      );
    }

    // V3 quoter for Uniswap V3 (try both old and new quoter)
    if (cfg.DEX_ROUTERS?.UNISWAP_V3_QUOTER_V2) {
      this.v3Quoter = new ethers.Contract(
        normalizeAddress(cfg.DEX_ROUTERS.UNISWAP_V3_QUOTER_V2),
        config.UNISWAP_V3_QUOTER_V2_ABI,
        provider,
      );
    } else if (cfg.DEX_ROUTERS?.UNISWAP_V3_QUOTER) {
      this.v3Quoter = new ethers.Contract(
        normalizeAddress(cfg.DEX_ROUTERS.UNISWAP_V3_QUOTER),
        config.UNISWAP_V3_QUOTER_ABI,
        provider,
      );
    }

    // Pool-liquidity validation: a quoter can return a plausible value for a
    // pool with no real liquidity. The pool's own on-chain state is the
    // authoritative filter (see liquidityValidator.js). Disable with
    // VALIDATE_LIQUIDITY=false if a chain has no factories configured.
    this.validateLiquidity = process.env.VALIDATE_LIQUIDITY !== "false";
    this.liquidityValidator = this.validateLiquidity
      ? new LiquidityValidator(provider, cfg)
      : null;
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

      // Reject pools that hold no meaningful liquidity before trusting the
      // router's quote (a thin pool returns a value no trade can realise).
      if (this.liquidityValidator) {
        const ok = await this.liquidityValidator.hasV2Liquidity(
          dexName,
          tokenIn,
          tokenOut,
        );
        if (!ok) return { amountOut: 0n, price: 0 };
      }

      // Normalize addresses for ethers v6
      const normalizedIn = normalizeAddress(tokenIn);
      const normalizedOut = normalizeAddress(tokenOut);
      const path = [normalizedIn, normalizedOut];

      // Get amount out using staticCall
      let amountOutNum;
      try {
        const amounts = await router.getAmountsOut.staticCall(amountIn, path);
        amountOutNum = amounts[1]; // Direct index access
      } catch (e) {
        return { amountOut: 0n, price: 0 };
      }

      let price = 0;
      try {
        const tokenInDecimals = await this.getTokenDecimals(normalizedIn);
        const tokenOutDecimals = await this.getTokenDecimals(normalizedOut);

        // Use BigInt.toString() to avoid conversion issues
        const amountOutStr = amountOutNum.toString();
        const amountInStr = amountIn.toString();
        price =
          (parseFloat(amountOutStr) / parseFloat(amountInStr)) *
          Math.pow(10, tokenInDecimals - tokenOutDecimals);
      } catch (e) {
        // Price calculation failed, but we still have amountOut
      }

      return { amountOut: amountOutNum, price };
    } catch (error) {
      console.log(
        `[getPriceV2] ${dexName} error: ${error.message.split("\n")[0]}`,
      );
      // Silent fail - no liquidity or unsupported pair
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
        0,
      );

      const tokenInDecimals = await this.getTokenDecimals(tokenIn);
      const tokenOutDecimals = await this.getTokenDecimals(tokenOut);

      // Pool validation: existence + minimum depth + price impact, in one call.
      // A pool can hold liquidity yet be far too shallow for this trade
      // (10000 USDC -> 398 DAI); the impact check rejects those.
      if (this.liquidityValidator) {
        const tradeable = await this.liquidityValidator.isV3Tradeable(
          tokenIn,
          tokenOut,
          fee,
          amountIn,
          amountOut,
          Number(tokenInDecimals),
          Number(tokenOutDecimals),
        );
        if (!tradeable) return { amountOut: 0n, price: 0 };
      }

      // getTokenDecimals returns a BigInt (from ethers). `10 ** BigInt` throws
      // "Cannot mix BigInt and other types", which the catch below would swallow
      // into a silent 0n — i.e. every V3 quote would look empty. Convert first.
      const price =
        (Number(amountOut) / Number(amountIn)) *
        Math.pow(10, Number(tokenInDecimals) - Number(tokenOutDecimals));

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
        const result = await this.getPriceV2(
          dexName,
          tokenIn,
          tokenOut,
          currentAmount,
        );
        if (result.amountOut > bestAmount) {
          bestAmount = result.amountOut;
        }
      }

      // Try V3 with different fees
      for (const fee of [100, 500, 3000, 10000]) {
        const result = await this.getPriceV3(
          tokenIn,
          tokenOut,
          fee,
          currentAmount,
        );
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
      const token = new ethers.Contract(
        tokenAddress,
        config.ERC20_ABI,
        this.provider,
      );
      const decimals = await token.decimals();
      this._decimalsCache[addr] = decimals;
      return decimals;
    } catch (error) {
      return 18; // Default to 18 decimals
    }
  }
}

module.exports = PriceOracle;
