// Smart arbitrage finder - finds ALL profitable routes
const { ethers } = require('ethers');
const config = require('./config');
const PriceAggregator = require('./priceAggregator');

class SmartArbitrageFinder {
  constructor(provider, priceOracle) {
    this.provider = provider;
    this.priceOracle = priceOracle;
    this.aggregator = new PriceAggregator(provider);
  }

  /**
   * Find ALL routes between two tokens and compare outputs
   * This finds opportunities where same input produces different outputs
   */
  async findBestRoute(tokenIn, tokenOut, amountIn) {
    const routes = [];
    
    // Try each DEX
    for (const dexName of Object.keys(this.priceOracle.routers)) {
      const result = await this.priceOracle.getPriceV2(dexName, tokenIn, tokenOut, amountIn);
      if (result.amountOut > 0n) {
        routes.push({
          dex: dexName,
          amountOut: result.amountOut,
          price: result.price,
          type: 'v2',
        });
      }
    }
    
    // Try Uniswap V3 with different fees
    for (const fee of [100, 500, 3000, 10000]) {
      const result = await this.priceOracle.getPriceV3(tokenIn, tokenOut, fee, amountIn);
      if (result.amountOut > 0n) {
        routes.push({
          dex: `UNISWAP_V3_${fee}`,
          amountOut: result.amountOut,
          price: result.price,
          type: 'v3',
          fee,
        });
      }
    }
    
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
    const WETH = config.TOKENS.WETH;
    
    // Find best route to buy tokenOut
    const buyRoutes = await this.findBestRoute(WETH, tokenOut, amountIn);
    if (buyRoutes.length < 2) return null;
    
    const bestBuy = buyRoutes[0];
    const worstBuy = buyRoutes[buyRoutes.length - 1];
    
    // Find best route to sell tokenOut back to WETH
    const sellRoutes = await this.findBestRoute(tokenOut, WETH, bestBuy.amountOut);
    if (sellRoutes.length < 2) return null;
    
    const bestSell = sellRoutes[0];
    
    // Calculate profit
    const finalAmount = bestSell.amountOut;
    const profit = finalAmount - amountIn;
    const premium = (amountIn * 5n) / 10000n; // 0.05%
    const netProfit = profit - premium;
    
    return {
      tokenOut,
      buyDex: bestBuy.dex,
      sellDex: bestSell.dex,
      buyAmount: bestBuy.amountOut,
      sellAmount: bestSell.amountOut,
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
      { symbol: 'USDC', address: config.TOKENS.USDC },
      { symbol: 'USDC_E', address: config.TOKENS.USDC_E },
      { symbol: 'USDT', address: config.TOKENS.USDT },
      { symbol: 'DAI', address: config.TOKENS.DAI },
    ];
    
    // Check all pairs of stablecoins
    for (let i = 0; i < stablecoins.length; i++) {
      for (let j = i + 1; j < stablecoins.length; j++) {
        const tokenA = stablecoins[i];
        const tokenB = stablecoins[j];
        
        // Find all routes A → B
        const routesAB = await this.findBestRoute(tokenA.address, tokenB.address, flashloanAmount);
        // Find all routes B → A
        const routesBA = await this.findBestRoute(tokenB.address, tokenA.address, flashloanAmount);
        
        if (routesAB.length === 0 || routesBA.length === 0) continue;
        
        // Best route A → B, then B → A
        const bestAB = routesAB[0];
        const bestBA = routesBA[0];
        
        // Calculate round-trip profit
        const afterFirstSwap = bestAB.amountOut;
        const afterSecondSwap = await this.priceOracle.getPriceV2(
          bestBA.dex.replace('UNISWAP_V3_', ''), 
          tokenB.address, 
          tokenA.address, 
          afterFirstSwap
        );
        
        if (afterSecondSwap.amountOut === 0n) continue;
        
        const finalAmount = afterSecondSwap.amountOut;
        const profit = finalAmount - flashloanAmount;
        const premium = (flashloanAmount * 5n) / 10000n;
        const netProfit = profit - premium;
        
        opportunities.push({
          type: 'stablecoin',
          pair: `${tokenA.symbol}/${tokenB.symbol}`,
          tokenIn: tokenA.address,
          tokenOut: tokenB.address,
          buyDex: bestAB.dex,
          sellDex: bestBA.dex,
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
   * Scan for opportunities using multi-DEX aggregator
   */
  async scanWithAggregator(flashloanAmount) {
    try {
      const opportunities = await this.aggregator.scanPairs(flashloanAmount);
      return opportunities.map(opp => ({
        type: 'multi-dex',
        source: 'multi-dex',
        ...opp,
      }));
    } catch (error) {
      console.error('Aggregator scan error:', error.message);
      return [];
    }
  }

  /**
   * Scan for ALL opportunities
   */
  async scanForOpportunities(flashloanAmount) {
    const opportunities = [];
    
    // 1. Multi-DEX aggregator (finds best routes across DEXes)
    const aggregatorOpps = await this.scanWithAggregator(flashloanAmount);
    opportunities.push(...aggregatorOpps);
    
    // 2. Check stablecoin arbitrage (local DEX queries)
    const stablecoinOpps = await this.findStablecoinArbitrage(flashloanAmount);
    opportunities.push(...stablecoinOpps);
    
    // 3. Check WETH pairs
    const wethPairs = [
      { symbol: 'USDC', address: config.TOKENS.USDC },
      { symbol: 'USDC_E', address: config.TOKENS.USDC_E },
      { symbol: 'USDT', address: config.TOKENS.USDT },
    ];
    
    for (const token of wethPairs) {
      const opp = await this.findRouteArbitrage(config.TOKENS.WETH, token.address, flashloanAmount);
      if (opp && opp.isProfitable) {
        opportunities.push({
          type: 'route',
          ...opp,
        });
      }
    }
    
    // Remove duplicates (same direction)
    const uniqueOpps = [];
    const seen = new Set();
    for (const opp of opportunities) {
      const key = `${opp.tokenIn || opp.tokenOut}-${opp.direction || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueOpps.push(opp);
      }
    }
    
    // Sort by net profit
    uniqueOpps.sort((a, b) => {
      if (a.netProfit > b.netProfit) return -1;
      if (a.netProfit < b.netProfit) return 1;
      return 0;
    });
    
    return uniqueOpps;
  }
}

module.exports = SmartArbitrageFinder;
