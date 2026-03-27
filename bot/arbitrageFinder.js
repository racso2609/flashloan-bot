// Arbitrage finder module - detects profitable opportunities
const { ethers } = require('ethers');
const config = require('./config');

class ArbitrageFinder {
  constructor(provider, priceOracle) {
    this.provider = provider;
    this.priceOracle = priceOracle;
  }

  /**
   * Find arbitrage opportunities between two DEXes
   * @param {string} tokenAddress - Token address to arbitrage
   * @param {string} tokenSymbol - Token symbol for logging
   * @param {string} dex1 - First DEX name
   * @param {string} dex2 - Second DEX name
   * @param {bigint} flashloanAmount - Flashloan amount in token units
   * @returns {Promise<Object|null>} Arbitrage opportunity or null
   */
  async findArbitrageOpportunity(tokenAddress, tokenSymbol, dex1, dex2, flashloanAmount) {
    const WETH = config.TOKENS.WETH;
    
    // Get price for buying token on DEX1
    const buyResult = await this.priceOracle.getPriceV2(dex1, WETH, tokenAddress, flashloanAmount);
    if (buyResult.amountOut === 0n) return null;
    
    // Get price for selling token on DEX2
    const sellResult = await this.priceOracle.getPriceV2(dex2, tokenAddress, WETH, buyResult.amountOut);
    if (sellResult.amountOut === 0n) return null;
    
    // Calculate profit/loss
    const profit = sellResult.amountOut - flashloanAmount;
    const profitPercent = Number(profit) / Number(flashloanAmount) * 100;
    
    // Get Aave flashloan premium (0.05% for Aave V3)
    const premium = (flashloanAmount * 5n) / 10000n; // 0.05%
    const netProfit = profit - premium;
    
    return {
      token: tokenAddress,
      tokenSymbol,
      dexBuy: dex1,
      dexSell: dex2,
      flashloanAmount,
      buyAmount: buyResult.amountOut,
      sellAmount: sellResult.amountOut,
      profit,
      profitPercent,
      premium,
      netProfit,
      isProfitable: netProfit > 0n,
    };
  }

  /**
   * Scan all configured pairs for arbitrage opportunities
   * @param {bigint} flashloanAmount - Flashloan amount
   * @returns {Promise<Array>} Array of profitable opportunities
   */
  async scanForOpportunities(flashloanAmount) {
    const opportunities = [];
    
    for (const [tokenA, tokenB] of config.TRADING_PAIRS) {
      const tokenAAddress = config.TOKENS[tokenA];
      const tokenBAddress = config.TOKENS[tokenB];
      
      // Skip if token addresses aren't configured
      if (!tokenAAddress || !tokenBAddress) continue;
      
      for (const [dex1, dex2] of config.DEX_PAIRS) {
        // Check both directions: buy on dex1, sell on dex2
        const opp1 = await this.findArbitrageOpportunity(
          tokenAAddress, tokenA, dex1, dex2, flashloanAmount
        );
        if (opp1 && opp1.isProfitable) {
          opportunities.push(opp1);
        }
        
        // Check reverse: buy on dex2, sell on dex1
        const opp2 = await this.findArbitrageOpportunity(
          tokenAAddress, tokenA, dex2, dex1, flashloanAmount
        );
        if (opp2 && opp2.isProfitable) {
          opportunities.push(opp2);
        }
      }
    }
    
    // Sort by net profit (highest first)
    opportunities.sort((a, b) => {
      if (a.netProfit > b.netProfit) return -1;
      if (a.netProfit < b.netProfit) return 1;
      return 0;
    });
    
    return opportunities;
  }

  /**
   * Build arbitrage parameters for the flashloan contract
   * @param {Object} opportunity - Arbitrage opportunity object
   * @returns {Object} Encoded arbitrage parameters
   */
  buildArbitrageParams(opportunity) {
    const WETH = config.TOKENS.WETH;
    
    // Leg 1: Buy token on first DEX
    const leg1 = {
      dexType: 0, // UNISWAP_V2
      router: config.DEX_ROUTERS[opportunity.dexBuy],
      path: [WETH, opportunity.token],
      fee: 0,
      amountOutMin: 0, // TODO: Calculate with slippage
    };
    
    // Leg 2: Sell token on second DEX
    const leg2 = {
      dexType: 0, // UNISWAP_V2
      router: config.DEX_ROUTERS[opportunity.dexSell],
      path: [opportunity.token, WETH],
      fee: 0,
      amountOutMin: 0, // TODO: Calculate with slippage
    };
    
    return {
      leg1,
      leg2,
    };
  }

  /**
   * Calculate minimum output with slippage protection
   * @param {bigint} expectedOutput - Expected output amount
   * @param {number} slippageBps - Slippage in basis points
   * @returns {bigint} Minimum output after slippage
   */
  calculateMinOutput(expectedOutput, slippageBps = config.SETTINGS.SLIPPAGE_BPS) {
    const slippageMultiplier = 10000 - slippageBps;
    return (expectedOutput * BigInt(slippageMultiplier)) / 10000n;
  }
}

module.exports = ArbitrageFinder;
