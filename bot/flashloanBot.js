// Flashloan arbitrage bot - main logic
const { ethers } = require('ethers');
const config = require('./config');
const PriceOracle = require('./priceOracle');
const ArbitrageFinder = require('./arbitrageFinder');

// Logger utility
const logger = {
  debug: (...args) => config.SETTINGS.LOG_LEVEL === 'debug' && console.log('[DEBUG]', new Date().toISOString(), ...args),
  info: (...args) => ['debug', 'info'].includes(config.SETTINGS.LOG_LEVEL) && console.log('[INFO]', new Date().toISOString(), ...args),
  warn: (...args) => console.warn('[WARN]', new Date().toISOString(), ...args),
  error: (...args) => console.error('[ERROR]', new Date().toISOString(), ...args),
};

class FlashloanBot {
  constructor() {
    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(config.RPC_URL);
    
    // Initialize wallet
    this.wallet = new ethers.Wallet(config.PRIVATE_KEY, this.provider);
    
    // Initialize flashloan contract
    this.flashloanContract = new ethers.Contract(
      config.FLASHLOAN_CONTRACT,
      config.FLASHLOAN_ABI,
      this.wallet
    );
    
    // Initialize modules
    this.priceOracle = new PriceOracle(this.provider);
    this.arbitrageFinder = new ArbitrageFinder(this.provider, this.priceOracle);
    
    // State
    this.isRunning = false;
    this.opportunitiesFound = 0;
    this.tradesExecuted = 0;
    this.totalProfit = 0n;
  }

  /**
   * Start the bot
   */
  async start() {
    logger.info('========================================');
    logger.info('  Flashloan Arbitrage Bot Starting...');
    logger.info('========================================');
    logger.info(`Mode: ${config.SETTINGS.DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    logger.info(`Min Profit: $${config.SETTINGS.MIN_PROFIT_USD}`);
    logger.info(`Max Gas: ${config.SETTINGS.MAX_GAS_PRICE_GWEI} Gwei`);
    logger.info(`Poll Interval: ${config.SETTINGS.POLL_INTERVAL_MS}ms`);
    logger.info(`Contract: ${config.FLASHLOAN_CONTRACT}`);
    logger.info('----------------------------------------');
    
    // Check wallet balance
    const balance = await this.provider.getBalance(this.wallet.address);
    logger.info(`Wallet: ${this.wallet.address}`);
    logger.info(`ETH Balance: ${ethers.formatEther(balance)} ETH`);
    
    if (balance === 0n) {
      logger.error('Wallet has no ETH! Please fund it first.');
      return;
    }
    
    this.isRunning = true;
    
    // Start main loop
    await this.mainLoop();
  }

  /**
   * Stop the bot
   */
  stop() {
    logger.info('Stopping bot...');
    this.isRunning = false;
  }

  /**
   * Main bot loop
   */
  async mainLoop() {
    while (this.isRunning) {
      try {
        await this.scanAndExecute();
      } catch (error) {
        logger.error('Error in main loop:', error.message);
      }
      
      // Wait before next scan
      await this.sleep(config.SETTINGS.POLL_INTERVAL_MS);
    }
  }

  /**
   * Scan for opportunities and execute if profitable
   */
  async scanAndExecute() {
    logger.debug('Scanning for arbitrage opportunities...');
    
    // Check gas price (ethers v6 uses getFeeData())
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));
    
    if (gasPriceGwei > config.SETTINGS.MAX_GAS_PRICE_GWEI) {
      logger.debug(`Gas price too high: ${gasPriceGwei.toFixed(2)} Gwei`);
      return;
    }
    
    // Scan for opportunities (use default flashloan amount)
    const flashloanAmount = BigInt(config.SETTINGS.DEFAULT_FLASHLOAN);
    const opportunities = await this.arbitrageFinder.scanForOpportunities(flashloanAmount);
    
    if (opportunities.length === 0) {
      logger.debug('No profitable opportunities found');
      return;
    }
    
    this.opportunitiesFound += opportunities.length;
    logger.info(`Found ${opportunities.length} profitable opportunity(ies)!`);
    
    // Execute the best opportunity
    const bestOpportunity = opportunities[0];
    await this.executeArbitrage(bestOpportunity, gasPrice);
  }

  /**
   * Execute an arbitrage trade
   * @param {Object} opportunity - Arbitrage opportunity
   * @param {bigint} gasPrice - Current gas price
   */
  async executeArbitrage(opportunity, gasPrice) {
    logger.info('----------------------------------------');
    logger.info('📊 Arbitrage Opportunity Found!');
    logger.info(`   Token: ${opportunity.tokenSymbol}`);
    logger.info(`   Buy on: ${opportunity.dexBuy}`);
    logger.info(`   Sell on: ${opportunity.dexSell}`);
    logger.info(`   Flashloan: ${ethers.formatUnits(opportunity.flashloanAmount, 6)} ${opportunity.tokenSymbol}`);
    logger.info(`   Gross Profit: ${ethers.formatUnits(opportunity.profit, 18)} WETH`);
    logger.info(`   Net Profit: ${ethers.formatUnits(opportunity.netProfit, 18)} WETH`);
    logger.info(`   Profit %: ${opportunity.profitPercent.toFixed(4)}%`);
    logger.info('----------------------------------------');
    
    if (config.SETTINGS.DRY_RUN) {
      logger.info('🏃 DRY RUN - Skipping execution');
      return;
    }
    
    try {
      // Build arbitrage params
      const arbParams = this.arbitrageFinder.buildArbitrageParams(opportunity);
      
      // Add slippage protection
      arbParams.leg1.amountOutMin = this.arbitrageFinder.calculateMinOutput(opportunity.buyAmount);
      arbParams.leg2.amountOutMin = this.arbitrageFinder.calculateMinOutput(opportunity.sellAmount);
      
      // Encode params
      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(tuple(uint8 dexType, address router, address[] path, uint256 fee, uint256 amountOutMin) leg1, tuple(uint8 dexType, address router, address[] path, uint256 fee, uint256 amountOutMin) leg2, address profitRecipient)'],
        [{
          leg1: arbParams.leg1,
          leg2: arbParams.leg2,
          profitRecipient: this.wallet.address,
        }]
      );
      
      // Estimate gas
      const gasEstimate = await this.flashloanContract.loan.estimateGas(
        opportunity.token,
        opportunity.flashloanAmount,
        params
      );
      
      const gasCost = gasEstimate * gasPrice;
      const gasCostEth = ethers.formatUnits(gasCost, 'ether');
      
      logger.info(`   Gas Estimate: ${gasEstimate.toString()} units`);
      logger.info(`   Gas Cost: ${gasCostEth} ETH`);
      
      // Execute the flashloan
      logger.info('🚀 Executing flashloan arbitrage...');
      
      const tx = await this.flashloanContract.loan(
        opportunity.token,
        opportunity.flashloanAmount,
        params,
        {
          gasLimit: gasEstimate * 120n / 100n, // 20% buffer
          gasPrice: gasPrice,
        }
      );
      
      logger.info(`   TX Hash: ${tx.hash}`);
      logger.info('   Waiting for confirmation...');
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.tradesExecuted++;
        this.totalProfit += opportunity.netProfit;
        logger.info('✅ Trade executed successfully!');
        logger.info(`   Gas Used: ${receipt.gasUsed.toString()}`);
        logger.info(`   Block: ${receipt.blockNumber}`);
      } else {
        logger.error('❌ Transaction failed!');
      }
      
    } catch (error) {
      logger.error('❌ Execution error:', error.message);
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get bot statistics
   */
  getStats() {
    return {
      opportunitiesFound: this.opportunitiesFound,
      tradesExecuted: this.tradesExecuted,
      totalProfit: this.totalProfit,
    };
  }
}

module.exports = FlashloanBot;
