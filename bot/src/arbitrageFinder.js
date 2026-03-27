// Arbitrage finder module - detects profitable opportunities
const { ethers } = require('ethers');
const config = require('../config/config');

class ArbitrageFinder {
  constructor(provider, priceOracle) {
    this.provider = provider;
    this.priceOracle = priceOracle;
  }

  /**
   * Find 2-leg arbitrage between two DEXes
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
    
    // Aave flashloan premium (0.05%)
    const premium = (flashloanAmount * 5n) / 10000n;
    const netProfit = profit - premium;
    
    return {
      type: '2-leg',
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
   * Find triangular arbitrage opportunity
   * Path: WETH → TokenA → TokenB → WETH
   */
  async findTriangularOpportunity(path, flashloanAmount) {
    const WETH = config.TOKENS.WETH;
    
    // Execute the path through the best DEXes
    const result = await this.priceOracle.getPriceThroughPath(path, flashloanAmount);
    
    if (!result.profitable || result.amountOut === 0n) {
      return null;
    }
    
    const profit = result.amountOut - flashloanAmount;
    const profitPercent = Number(profit) / Number(flashloanAmount) * 100;
    
    // Aave flashloan premium (0.05%)
    const premium = (flashloanAmount * 5n) / 10000n;
    const netProfit = profit - premium;
    
    return {
      type: 'triangular',
      path,
      flashloanAmount,
      finalAmount: result.amountOut,
      profit,
      profitPercent,
      premium,
      netProfit,
      isProfitable: netProfit > 0n,
    };
  }

  /**
   * Scan for all types of opportunities
   */
  async scanForOpportunities(flashloanAmount) {
    const opportunities = [];
    
    // 1. Scan 2-leg arbitrage (DEX vs DEX)
    for (const [tokenA, tokenB] of config.TRADING_PAIRS) {
      const tokenAAddress = config.TOKENS[tokenA];
      if (!tokenAAddress) continue;
      
      for (const [dex1, dex2] of config.DEX_PAIRS) {
        const opp1 = await this.findArbitrageOpportunity(
          tokenAAddress, tokenA, dex1, dex2, flashloanAmount
        );
        if (opp1 && opp1.isProfitable) {
          opportunities.push(opp1);
        }
        
        const opp2 = await this.findArbitrageOpportunity(
          tokenAAddress, tokenA, dex2, dex1, flashloanAmount
        );
        if (opp2 && opp2.isProfitable) {
          opportunities.push(opp2);
        }
      }
    }
    
    // 2. Scan triangular arbitrage (if enabled)
    if (config.SETTINGS.ENABLE_TRIANGULAR) {
      for (const pathSymbols of config.TRIANGULAR_PATHS) {
        // Convert symbols to addresses
        const path = pathSymbols.map(symbol => config.TOKENS[symbol]).filter(Boolean);
        
        if (path.length !== pathSymbols.length) continue;
        
        const opp = await this.findTriangularOpportunity(path, flashloanAmount);
        if (opp && opp.isProfitable) {
          opportunities.push({
            ...opp,
            tokenSymbol: pathSymbols.join(' → '),
          });
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
   */
  buildArbitrageParams(opportunity) {
    const WETH = config.TOKENS.WETH;
    
    if (opportunity.type === '2-leg') {
      // Standard 2-leg arbitrage
      return {
        leg1: {
          dexType: 0,
          router: config.DEX_ROUTERS[opportunity.dexBuy],
          path: [WETH, opportunity.token],
          fee: 0,
          amountOutMin: 0,
        },
        leg2: {
          dexType: 0,
          router: config.DEX_ROUTERS[opportunity.dexSell],
          path: [opportunity.token, WETH],
          fee: 0,
          amountOutMin: 0,
        },
      };
    }
    
    // Triangular - use first and last DEX from path
    return {
      leg1: {
        dexType: 0,
        router: config.DEX_ROUTERS.SUSHISWAP, // Default to SushiSwap
        path: [opportunity.path[0], opportunity.path[1]],
        fee: 0,
        amountOutMin: 0,
      },
      leg2: {
        dexType: 0,
        router: config.DEX_ROUTERS.CAMELOT, // Default to Camelot
        path: [opportunity.path[1], opportunity.path[0]],
        fee: 0,
        amountOutMin: 0,
      },
    };
  }

  /**
   * Calculate minimum output with slippage
   */
  calculateMinOutput(expectedOutput, slippageBps = config.SETTINGS.SLIPPAGE_BPS) {
    const slippageMultiplier = 10000 - slippageBps;
    return (expectedOutput * BigInt(slippageMultiplier)) / 10000n;
  }
}

module.exports = ArbitrageFinder;
