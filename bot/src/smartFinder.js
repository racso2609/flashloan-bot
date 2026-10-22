// Smart arbitrage finder - finds ALL profitable routes
const { ethers } = require("ethers");
const config = require("../config/config");
const PriceAggregator = require("./priceAggregator");
const { bestRouteExcludingVenue } = require("./routeValidation");
const { flashloanPremium, netOfPremium } = require("./flashloanPremium");

class SmartArbitrageFinder {
  constructor(provider, priceOracle, chainConfig) {
    this.provider = provider;
    this.priceOracle = priceOracle;
    this.aggregator = new PriceAggregator(provider);
    // Use passed config or default (chain-specific tokens will be used)
    this.chainConfig = chainConfig || config;
    // Native-token cost of a full flashloan round-trip. Set per scan.
    this.gasCostNative = 0n;
  }

  /**
   * Estimate gas cost of executing an arbitration in native token (WETH) wei.
   * Uses a conservative gas figure covering loan() + 2 swaps + Aave callback.
   */
  async estimateGasCost(gasPrice, nativeToken) {
    if (!gasPrice || gasPrice <= 0n) return 0n;

    // Fallback constant (loan + 2 swaps + flashloan overhead)
    let gasUnits = BigInt(process.env.EXEC_GAS_UNITS || "600000");

    // Try on-chain estimate against the deployed contract for accuracy
    try {
      if (this.flashloanContract) {
        const estimated = await this.flashloanContract.loan.estimateGas(
          this.chainConfig?.tokens?.USDC,
          BigInt(this.chainConfig?.SETTINGS?.DEFAULT_FLASHLOAN || "1000000000"),
          "0x",
        );
        if (estimated > gasUnits) gasUnits = estimated;
      }
    } catch {
      // No contract / not deployed yet — keep constant
    }

    return gasUnits * gasPrice;
  }

  /**
   * Convert a native-token (WETH) cost into the input-token denomination.
   * Uses the price oracle route WETH -> tokenIn so net profit is comparable.
   */
  async nativeToToken(amountNative, tokenIn) {
    if (amountNative === 0n || !tokenIn) return 0n;
    const WETH = this.TOKENS.WETH;
    if (!WETH) return 0n;
    if (WETH.toLowerCase() === tokenIn.toLowerCase()) return amountNative;

    const routes = await this.findBestRoute(WETH, tokenIn, amountNative);
    if (routes.length === 0) return 0n;
    return routes[0].amountOut;
  }

  /**
   * Attach gas cost (denominated in the opportunity input token) to an
   * opportunity and recompute netProfit / isProfitable accordingly.
   */
  async applyGasCost(opp) {
    if (this.gasCostNative === 0n || !opp) return opp;

    const tokenIn = opp.tokenIn || opp.token || this.TOKENS.USDC;
    const gasCostToken = await this.nativeToToken(this.gasCostNative, tokenIn);

    const profit =
      opp.profit !== undefined && opp.profit !== null
        ? BigInt(opp.profit)
        : null;
    const premium = BigInt(opp.premium || 0);
    const netProfit = (profit !== null ? profit : 0n) - premium - gasCostToken;

    return {
      ...opp,
      gasCost: gasCostToken,
      gasCostNative: this.gasCostNative,
      netProfit,
      isProfitable: netProfit > 0n,
    };
  }

  // Helper to get tokens from chain config
  get TOKENS() {
    // Chain config uses 'tokens' lowercase
    return this.chainConfig?.tokens || {};
  }

  /**
   * Find ALL routes between two tokens and compare outputs
   * This finds opportunities where same input produces different outputs
   */
  async findBestRoute(tokenIn, tokenOut, amountIn) {
    const routes = [];
    const availableRouters = Object.keys(this.priceOracle.routers || {});

    if (!tokenIn || !tokenOut) return routes;

    // Try each DEX
    for (const dexName of availableRouters) {
      const result = await this.priceOracle.getPriceV2(
        dexName,
        tokenIn,
        tokenOut,
        amountIn,
      );
      if (result.amountOut > 0n) {
        routes.push({
          dex: dexName,
          amountOut: result.amountOut,
          price: result.price,
          type: "v2",
        });
      }
    }

    // Try Uniswap V3 with different fees
    if (this.priceOracle.v3Quoter) {
      for (const fee of [100, 500, 3000, 10000]) {
        const result = await this.priceOracle.getPriceV3(
          tokenIn,
          tokenOut,
          fee,
          amountIn,
        );
        if (result.amountOut > 0n) {
          routes.push({
            dex: `UNISWAP_V3_${fee}`,
            amountOut: result.amountOut,
            price: result.price,
            type: "v3",
            fee,
          });
        }
      }
    }

    // NOTE: no magnitude-based outlier filter here. Pool liquidity is validated
    // authoritatively inside the oracle (liquidityValidator), so every route
    // that reaches this point is tradeable. Filtering by quote magnitude was
    // wrong: it kept inflated phantoms and discarded real venues.

    // Sort by amountOut (best first)
    routes.sort((a, b) => {
      if (a.amountOut > b.amountOut) return -1;
      if (a.amountOut < b.amountOut) return 1;
      return 0;
    });

    return routes;
  }

  /**
   * Find arbitrage between best buy route and best sell route
   */
  async findRouteArbitrage(tokenIn, tokenOut, amountIn) {
    const WETH = this.TOKENS.WETH;

    // Find best route to buy tokenOut
    const buyRoutes = await this.findBestRoute(WETH, tokenOut, amountIn);
    if (buyRoutes.length === 0) return null;

    const bestBuy = buyRoutes[0];
    const worstBuy = buyRoutes[buyRoutes.length - 1];

    // Find best route to sell tokenOut back to WETH
    const sellRoutes = await this.findBestRoute(
      tokenOut,
      WETH,
      bestBuy.amountOut,
    );
    if (sellRoutes.length === 0) return null;

    const bestSell = sellRoutes[0];

    // Selling on the same venue we bought from can only lose the fee twice.
    // But that does not void the opportunity: a lower-ranked venue on the sell
    // side may still give a real cross-venue edge, so pick the best compatible
    // leg instead of aborting (this used to discard real arbitrages).
    const sell = bestRouteExcludingVenue(sellRoutes, bestBuy.dex);
    if (!sell) return null;

    // Calculate profit
    const finalAmount = sell.amountOut;
    const profit = finalAmount - amountIn;
    const premium = flashloanPremium(amountIn);
    const netProfit = netOfPremium(profit, amountIn);

    return {
      tokenIn: WETH,
      tokenOut,
      buyDex: bestBuy.dex,
      sellDex: sell.dex,
      buyAmount: bestBuy.amountOut,
      sellAmount: sell.amountOut,
      finalAmount,
      profit,
      netProfit,
      premium,
      isProfitable: netProfit > 0n,
      // For debugging
      allBuyRoutes: buyRoutes.length,
      allSellRoutes: sellRoutes.length,
      priceDiff: bestBuy.price - worstBuy.price,
    };
  }

  /**
   * Find stablecoin arbitrage (USDC ↔ USDC.e, etc.)
   * These have tiny spreads but high volume
   */
  async findStablecoinArbitrage(flashloanAmount) {
    const opportunities = [];

    const stablecoins = [
      { symbol: "USDC", address: this.TOKENS.USDC },
      { symbol: "USDC_E", address: this.TOKENS.USDC_E },
      { symbol: "USDT", address: this.TOKENS.USDT },
      { symbol: "DAI", address: this.TOKENS.DAI },
    ];

    // Check all pairs of stablecoins
    for (let i = 0; i < stablecoins.length; i++) {
      for (let j = i + 1; j < stablecoins.length; j++) {
        const tokenA = stablecoins[i];
        const tokenB = stablecoins[j];

        // Find all routes A → B
        const routesAB = await this.findBestRoute(
          tokenA.address,
          tokenB.address,
          flashloanAmount,
        );
        if (routesAB.length === 0) continue;

        // Best route A → B
        const bestAB = routesAB[0];

        // Find the best route B → A priced on the amount we actually hold
        // after the first swap (not the original flashloan amount).
        const routesBA = await this.findBestRoute(
          tokenB.address,
          tokenA.address,
          bestAB.amountOut,
        );
        if (routesBA.length === 0) continue;

        const bestBA = routesBA[0];

        // Buying and selling on the same pool only pays the fee twice, so pick
        // the best sell leg on a DIFFERENT venue. Aborting outright would throw
        // away a real cross-venue edge just because the top venue matched.
        const sellBA = bestRouteExcludingVenue(routesBA, bestAB.dex);
        if (!sellBA) continue;

        // Round-trip profit: sell on the best cross-venue B → A route
        const finalAmount = sellBA.amountOut;
        const profit = finalAmount - flashloanAmount;
        const premium = flashloanPremium(flashloanAmount);
        const netProfit = netOfPremium(profit, flashloanAmount);

        opportunities.push({
          type: "stablecoin",
          pair: `${tokenA.symbol}/${tokenB.symbol}`,
          tokenIn: tokenA.address,
          tokenOut: tokenB.address,
          buyDex: bestAB.dex,
          sellDex: sellBA.dex,
          buyAmount: bestAB.amountOut,
          sellAmount: sellBA.amountOut,
          flashloanAmount,
          finalAmount,
          profit,
          netProfit,
          premium,
          isProfitable: netProfit > 0n,
        });
      }
    }

    return opportunities;
  }

  /**
   * Find triangular arbitrage opportunities
   * A → B → C → A cycle looking for price inefficiencies
   */
  async findTriangularArbitrage(flashloanAmount) {
    const opportunities = [];

    // Get all tokens available on this chain
    const tokens = [
      { symbol: "WETH", address: this.TOKENS.WETH },
      { symbol: "USDC", address: this.TOKENS.USDC },
      { symbol: "USDT", address: this.TOKENS.USDT },
      { symbol: "DAI", address: this.TOKENS.DAI },
    ];

    // Add chain-specific tokens
    if (this.TOKENS.USDC_E) {
      tokens.push({ symbol: "USDC_E", address: this.TOKENS.USDC_E });
    }
    if (this.TOKENS.cbETH) {
      tokens.push({ symbol: "cbETH", address: this.TOKENS.cbETH });
    }

    // Try all triangular paths (3-token cycles)
    let pathsChecked = 0;
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        for (let k = j + 1; k < tokens.length; k++) {
          const tokenA = tokens[i];
          const tokenB = tokens[j];
          const tokenC = tokens[k];

          // Try both directions: A→B→C→A and A→C→B→A
          const cycles = [
            [tokenA, tokenB, tokenC], // A → B → C → A
            [tokenA, tokenC, tokenB], // A → C → B → A
          ];

          for (const cycle of cycles) {
            pathsChecked++;
            try {
              const result = await this.calculateTriangularProfit(
                cycle[0].address,
                cycle[1].address,
                cycle[2].address,
                flashloanAmount,
              );

              // Log even if not profitable for debugging
              if (result) {
                console.log(
                  `[TRI] ${cycle[0].symbol}→${cycle[1].symbol}→${cycle[2].symbol}→${cycle[0].symbol}: profit=${result.profit}, net=${result.netProfit}`,
                );
              }

              if (result && result.netProfit > 0n) {
                opportunities.push({
                  type: "triangular",
                  path: `${cycle[0].symbol} → ${cycle[1].symbol} → ${cycle[2].symbol} → ${cycle[0].symbol}`,
                  tokenIn: cycle[0].address,
                  intermediate1: cycle[1].address,
                  intermediate2: cycle[2].address,
                  dex1: result.dex1,
                  dex2: result.dex2,
                  dex3: result.dex3,
                  flashloanAmount,
                  finalAmount: result.finalAmount,
                  profit: result.profit,
                  netProfit: result.netProfit,
                  premium: result.premium,
                  isProfitable: true,
                });
              }
            } catch (e) {
              // Skip failed paths silently
            }
          }
        }
      }
    }

    console.log(`[TRI] Total paths checked: ${pathsChecked}`);
    return opportunities;
  }

  /**
   * Calculate profit for a triangular path
   */
  async calculateTriangularProfit(tokenA, tokenB, tokenC, amountIn) {
    console.log(
      `[TRI] Testing ${tokenA?.slice(0, 6)}... → ${tokenB?.slice(0, 6)}... → ${tokenC?.slice(0, 6)}...`,
    );
    try {
      // Step 1: A → B (get all routes)
      const routesAB = await this.findBestRoute(tokenA, tokenB, amountIn);
      console.log(`[TRI] A→B routes: ${routesAB.length}`);
      if (routesAB.length === 0) return null;

      // Step 2: B → C (get all routes)
      const routesBC = await this.findBestRoute(
        tokenB,
        tokenC,
        routesAB[0].amountOut,
      );
      console.log(`[TRI] B→C routes: ${routesBC.length}`);
      if (routesBC.length === 0) return null;

      // Step 3: C → A (get all routes)
      const routesCA = await this.findBestRoute(
        tokenC,
        tokenA,
        routesBC[0].amountOut,
      );
      console.log(`[TRI] C→A routes: ${routesCA.length}`);
      if (routesCA.length === 0) return null;

      // Calculate profit
      const finalAmount = routesCA[0].amountOut;
      const profit = finalAmount - amountIn;
      const premium = flashloanPremium(amountIn);
      const netProfit = netOfPremium(profit, amountIn);

      // NOTE: do not discard cycles by venue name. Three legs through the same
      // router are three DIFFERENT pools (A/B, B/C, C/A) and can be a real
      // arbitrage — a mono-venue cycle only loses to its fees when it is the
      // same pool, which A→B→C→A cannot be. The flashloan premium is already
      // deducted above, so netProfit is the honest arbiter.
      const dex1 = routesAB[0].dex;
      const dex2 = routesBC[0].dex;
      const dex3 = routesCA[0].dex;

      return {
        dex1,
        dex2,
        dex3,
        finalAmount,
        profit,
        netProfit,
        premium,
      };
    } catch (error) {
      console.log(`[TRI] Error: ${error.message}`);
      return null;
    }
  }

  /**
   * Scan for opportunities using multi-DEX aggregator
   */
  async scanWithAggregator(flashloanAmount) {
    try {
      const opportunities = await this.aggregator.scanPairs(flashloanAmount);
      return opportunities.map((opp) => ({
        // type: "multi-dex",
        source: "multi-dex",
        ...opp,
      }));
    } catch (error) {
      console.error("Aggregator scan error:", error.message);
      return [];
    }
  }

  /**
   * Scan for ALL opportunities
   */
  async scanForOpportunities(flashloanAmount, opts = {}) {
    // Compute gas cost once for the whole scan
    if (opts.gasPrice) {
      this.gasCostNative = await this.estimateGasCost(
        BigInt(opts.gasPrice),
        opts.nativeToken || this.TOKENS.WETH,
      );
    }

    const opportunities = [];

    // 1. Multi-DEX aggregator (finds best routes across DEXes)
    const aggregatorOpps = await this.scanWithAggregator(flashloanAmount);
    opportunities.push(...aggregatorOpps);
    console.log(
      `Aggregator found ${aggregatorOpps.length} opportunities`,
      aggregatorOpps,
    );

    // 2. Check stablecoin arbitrage (local DEX queries)
    const stablecoinOpps = await this.findStablecoinArbitrage(flashloanAmount);
    opportunities.push(...stablecoinOpps);
    console.log(
      `Stablecoin arbitrage found ${stablecoinOpps.length} opportunities`,
      stablecoinOpps,
    );

    // 3. Check WETH pairs
    const wethPairs = [
      { symbol: "USDC", address: this.TOKENS.USDC },
      { symbol: "USDC_E", address: this.TOKENS.USDC_E },
      { symbol: "USDT", address: this.TOKENS.USDT },
    ];

    for (const token of wethPairs) {
      const opp = await this.findRouteArbitrage(
        this.TOKENS.WETH,
        token.address,
        flashloanAmount,
      );
      console.log(`Route arbitrage WETH/${token.symbol} found:`, opp);
      if (opp && opp.isProfitable) {
        opportunities.push({
          type: "route",
          ...opp,
        });
      }
    }

    // 4. Check triangular arbitrage
    console.log("🔄 Scanning for triangular arbitrage...");
    const triangularOpps = await this.findTriangularArbitrage(flashloanAmount);
    console.log(
      `Triangular arbitrage found ${triangularOpps.length} opportunities`,
    );
    opportunities.push(...triangularOpps);

    // Remove duplicates (same direction)
    const uniqueOpps = [];
    const seen = new Set();
    for (const opp of opportunities) {
      const key = `${opp.tokenIn || opp.tokenOut}-${opp.direction || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Discount gas from net profit before final filtering
        const withGas = await this.applyGasCost(opp);
        uniqueOpps.push(withGas);
      }
    }

    // Keep only net-profitable opportunities
    const profitable = uniqueOpps.filter((opp) => opp.isProfitable);

    // Sort by net profit
    profitable.sort((a, b) => {
      if (a.netProfit > b.netProfit) return -1;
      if (a.netProfit < b.netProfit) return 1;
      return 0;
    });

    return profitable;
  }
}

module.exports = SmartArbitrageFinder;
