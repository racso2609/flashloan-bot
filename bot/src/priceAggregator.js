// Multi-source price aggregator
// Uses multiple APIs and direct DEX queries for best results

const config = require('../config/config');
const { flashloanPremium, netOfPremium } = require('./flashloanPremium');

class PriceAggregator {
  constructor(provider) {
    this.provider = provider;
    this.cache = new Map();
    this.cacheTtl = 10000; // 10 seconds
  }

  /**
   * Get best price from all sources
   */
  async getBestPrice(tokenIn, tokenOut, amountIn) {
    const results = [];
    
    // 1. Try direct DEX queries
    const dexResults = await this.queryDirectDEXes(tokenIn, tokenOut, amountIn);
    results.push(...dexResults);
    
    // 2. Sort by output amount
    results.sort((a, b) => {
      if (a.amountOut > b.amountOut) return -1;
      if (a.amountOut < b.amountOut) return 1;
      return 0;
    });
    
    return results[0] || null;
  }

  /**
   * Query DEX routers directly
   */
  async queryDirectDEXes(tokenIn, tokenOut, amountIn) {
    const results = [];
    
    // Skip if same token
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      return results;
    }

    // Router ABI
    const ROUTER_ABI = [
      'function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts)',
    ];

    const routers = [
      { name: 'SushiSwap', address: config.DEX_ROUTERS.SUSHISWAP },
      { name: 'Camelot', address: config.DEX_ROUTERS.CAMELOT },
    ].filter(r => r.address);

    for (const router of routers) {
      try {
        const contract = new ethers.Contract(router.address, ROUTER_ABI, this.provider);
        const path = [tokenIn, tokenOut];
        const amounts = await contract.getAmountsOut.staticCall(amountIn, path);
        
        results.push({
          dex: router.name,
          amountOut: amounts[amounts.length - 1],
          source: 'direct',
        });
      } catch (error) {
        // Pool doesn't exist or reverted
      }
    }
    
    return results;
  }

  /**
   * Find arbitrage opportunity
   * Buy low on DEX A, sell high on DEX B
   */
  async findArbitrage(tokenIn, tokenOut, amountIn) {
    // Get all prices for buy (tokenIn → tokenOut)
    const buyPrices = await this.queryDirectDEXes(tokenIn, tokenOut, amountIn);
    
    if (buyPrices.length < 2) {
      // Need at least 2 DEXes to compare
      return null;
    }
    
    // Sort: best (highest output) first
    buyPrices.sort((a, b) => b.amountOut - a.amountOut);
    
    const bestBuy = buyPrices[0];
    const worstBuy = buyPrices[buyPrices.length - 1];
    
    // Check if there's a spread
    const spread = bestBuy.amountOut - worstBuy.amountOut;
    if (spread <= 0n) {
      return null;
    }
    
    // Now simulate selling on the worst DEX
    const sellPrices = await this.queryDirectDEXes(tokenOut, tokenIn, bestBuy.amountOut);
    
    if (sellPrices.length === 0) {
      return null;
    }
    
    // Find best sell price
    sellPrices.sort((a, b) => b.amountOut - a.amountOut);
    const bestSell = sellPrices[0];
    
    // Calculate profit
    const finalAmount = bestSell.amountOut;
    const profit = finalAmount - amountIn;
    const premium = flashloanPremium(amountIn);
    const netProfit = netOfPremium(profit, amountIn);
    
    return {
      tokenIn,
      tokenOut,
      buyDex: bestBuy.dex,
      sellDex: bestSell.dex,
      initialAmount: amountIn,
      buyAmount: bestBuy.amountOut,
      sellAmount: bestSell.amountOut,
      finalAmount,
      profit,
      premium,
      netProfit,
      isProfitable: netProfit > 0n,
      spread,
      source: 'multi-dex',
    };
  }

  /**
   * Scan all configured pairs for arbitrage
   */
  async scanPairs(flashloanAmount) {
    const opportunities = [];
    
    const pairs = [
      ['USDC', 'USDC_E'],
      ['USDC', 'USDT'],
      ['USDC_E', 'USDC'],
      ['USDT', 'USDC'],
      ['USDT', 'USDC_E'],
      ['DAI', 'USDC'],
      ['WETH', 'USDC'],
      ['WETH', 'USDC_E'],
    ];
    
    const amount = BigInt(flashloanAmount);
    
    for (const [sym1, sym2] of pairs) {
      const token1 = config.TOKENS[sym1];
      const token2 = config.TOKENS[sym2];
      
      if (!token1 || !token2) continue;
      
      try {
        const opp = await this.findArbitrage(token1, token2, amount);
        if (opp && opp.isProfitable) {
          opportunities.push({
            ...opp,
            pair: `${sym1}/${sym2}`,
            direction: `${sym1} → ${sym2} → ${sym1}`,
          });
        }
      } catch (error) {
        // Skip errors for this pair
      }
    }
    
    // Sort by net profit
    opportunities.sort((a, b) => {
      const aProfit = BigInt(a.netProfit || 0);
      const bProfit = BigInt(b.netProfit || 0);
      if (aProfit > bProfit) return -1;
      if (aProfit < bProfit) return 1;
      return 0;
    });
    
    return opportunities;
  }
}

// Import ethers at top
const { ethers } = require('ethers');

module.exports = PriceAggregator;
