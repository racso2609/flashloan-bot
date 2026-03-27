// 1inch API integration for optimal route finding
// Documentation: https://docs.1inch.io/docs/swap/api/get-quote

const config = require('./config');

const ONEINCH_API_BASE = 'https://api.1inch.dev';
const CHAIN_ID = 42161; // Arbitrum

class OneInchService {
  constructor(apiKey = null) {
    this.apiKey = apiKey;
    this.baseUrl = `${ONEINCH_API_BASE}/swap/v6.0/${CHAIN_ID}`;
  }

  /**
   * Get quote from 1inch (finds best route across all DEXes)
   * @param {string} src - Source token address
   * @param {string} dst - Destination token address
   * @param {string} amount - Amount in token decimals (string)
   * @returns {Promise<Object>} Quote with best route
   */
  async getQuote(src, dst, amount) {
    const params = new URLSearchParams({
      src,
      dst,
      amount: amount.toString(),
      includeProtocols: 'true',
      includeGas: 'true',
    });

    const url = `${this.baseUrl}/quote?${params}`;
    
    const headers = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`1inch API error: ${response.status} - ${error}`);
      }
      
      const data = await response.json();
      return {
        srcAmount: BigInt(data.srcAmount),
        dstAmount: BigInt(data.dstAmount),
        gas: data.gas || 0,
        protocols: data.protocols || [],
        estimatedProfit: BigInt(data.dstAmount),
      };
    } catch (error) {
      console.error('1inch quote error:', error.message);
      return null;
    }
  }

  /**
   * Get swap transaction data from 1inch
   * @param {string} src - Source token
   * @param {string} dst - Destination token  
   * @param {string} amount - Amount to swap
   * @param {string} from - Sender address
   * @param {number} slippage - Slippage in percentage (e.g., 1 for 1%)
   * @returns {Promise<Object>} Transaction data
   */
  async getSwapData(src, dst, amount, from, slippage = 1) {
    const params = new URLSearchParams({
      src,
      dst,
      amount: amount.toString(),
      from,
      slippage: slippage.toString(),
      disableEstimate: 'false',
      allowPartialFill: 'false',
    });

    const url = `${this.baseUrl}/swap?${params}`;
    
    const headers = {};
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`1inch swap error: ${response.status} - ${error}`);
      }
      
      const data = await response.json();
      return {
        to: data.tx.to,
        data: data.tx.data,
        value: data.tx.value || '0',
        gas: data.tx.gas,
        gasPrice: data.tx.gasPrice,
        dstAmount: BigInt(data.dstAmount),
      };
    } catch (error) {
      console.error('1inch swap error:', error.message);
      return null;
    }
  }

  /**
   * Find arbitrage opportunity using 1inch
   * @param {string} tokenIn - Input token
   * @param {string} tokenOut - Output token
   * @param {string} amount - Amount to arbitrage
   * @returns {Promise<Object|null>} Arbitrage opportunity
   */
  async findArbitrage(tokenIn, tokenOut, amount) {
    // Get quote for tokenIn → tokenOut
    const quote = await this.getQuote(tokenIn, tokenOut, amount);
    
    if (!quote || quote.dstAmount === 0n) {
      return null;
    }

    // Get quote for reverse: tokenOut → tokenIn (for the profit leg)
    const reverseQuote = await this.getQuote(tokenOut, tokenIn, quote.dstAmount.toString());
    
    if (!reverseQuote || reverseQuote.dstAmount === 0n) {
      return null;
    }

    // Calculate profit
    const finalAmount = reverseQuote.dstAmount;
    const initialAmount = BigInt(amount);
    const profit = finalAmount - initialAmount;
    
    // Aave flashloan premium (0.05%)
    const premium = (initialAmount * 5n) / 10000n;
    const netProfit = profit - premium;

    return {
      tokenIn,
      tokenOut,
      initialAmount,
      buyAmount: quote.dstAmount,
      sellAmount: reverseQuote.dstAmount,
      finalAmount,
      profit,
      premium,
      netProfit,
      isProfitable: netProfit > 0n,
      source: '1inch',
      gasEstimate: quote.gas + reverseQuote.gas,
    };
  }

  /**
   * Check multiple token pairs for arbitrage using 1inch
   */
  async scanPairs(pairs, flashloanAmount) {
    const opportunities = [];

    for (const [tokenSymbol1, tokenSymbol2] of pairs) {
      const token1 = config.TOKENS[tokenSymbol1];
      const token2 = config.TOKENS[tokenSymbol2];
      
      if (!token1 || !token2) continue;

      // Test with different flashloan amounts
      const amounts = [
        config.SETTINGS.FLASHLOAN_AMOUNTS[tokenSymbol1] || config.SETTINGS.DEFAULT_FLASHLOAN,
        config.SETTINGS.FLASHLOAN_AMOUNTS[tokenSymbol2] || null,
      ].filter(Boolean);

      for (const amount of amounts) {
        // Test token1 → token2 → token1
        const opp1 = await this.findArbitrage(token1, token2, amount);
        if (opp1 && opp1.isProfitable) {
          opportunities.push({
            ...opp1,
            pair: `${tokenSymbol1}/${tokenSymbol2}`,
            direction: `${tokenSymbol1} → ${tokenSymbol2} → ${tokenSymbol1}`,
          });
        }

        // Test token2 → token1 → token2
        const opp2 = await this.findArbitrage(token2, token1, amount);
        if (opp2 && opp2.isProfitable) {
          opportunities.push({
            ...opp2,
            pair: `${tokenSymbol2}/${tokenSymbol1}`,
            direction: `${tokenSymbol2} → ${tokenSymbol1} → ${tokenSymbol2}`,
          });
        }
      }
    }

    // Sort by net profit
    opportunities.sort((a, b) => {
      if (a.netProfit > b.netProfit) return -1;
      if (a.netProfit < b.netProfit) return 1;
      return 0;
    });

    return opportunities;
  }

  /**
   * Get token price in USD (using stablecoin reference)
   */
  async getTokenPriceUSD(tokenAddress) {
    const USDC = config.TOKENS.USDC;
    const amount = '1000000'; // 1 USDC (6 decimals)
    
    // Try to get 1 unit of token in USDC
    const quote = await this.getQuote(tokenAddress, USDC, '1000000000000000000'); // 1 token
    
    if (quote && quote.dstAmount > 0n) {
      // Price = USDC amount / 10^6 (USDC decimals)
      return Number(quote.dstAmount) / 1e6;
    }
    
    return null;
  }
}

module.exports = OneInchService;
