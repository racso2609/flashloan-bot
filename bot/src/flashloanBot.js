// Flashloan arbitrage bot - Multi-chain support with detailed logging
const { ethers } = require("ethers");
const { getChainConfig } = require("./chains");
const PriceOracle = require("./priceOracle");
const ArbitrageFinder = require("./arbitrageFinder");
const SmartArbitrageFinder = require("./smartFinder");

// Global config reference (set in constructor)
let config;

// Logger utility (lazy-loads config)
const logger = {
  debug: (...args) =>
    config?.SETTINGS?.LOG_LEVEL === "debug" &&
    console.log("[DEBUG]", new Date().toISOString(), ...args),
  info: (...args) =>
    ["debug", "info"].includes(config?.SETTINGS?.LOG_LEVEL || "info") &&
    console.log("[INFO]", new Date().toISOString(), ...args),
  warn: (...args) => console.warn("[WARN]", new Date().toISOString(), ...args),
  error: (...args) =>
    console.error("[ERROR]", new Date().toISOString(), ...args),

  // Detailed opportunity logging
  opportunity: (opp, chainConfig) => {
    const cfg = chainConfig || config;
    console.log("\n" + "═".repeat(60));
    console.log("🎯 ARBITRAGE OPPORTUNITY FOUND");
    console.log("═".repeat(60));

    if (opp.pair) console.log(`   Pair:     ${opp.pair}`);
    if (opp.direction) console.log(`   Route:    ${opp.direction}`);
    if (opp.source) console.log(`   Source:   ${opp.source}`);

    console.log("─".repeat(60));

    // Token info
    if (opp.tokenIn && opp.tokenOut && cfg?.TOKENS) {
      const symIn =
        Object.entries(cfg.TOKENS).find(
          ([k, v]) => v.toLowerCase() === opp.tokenIn.toLowerCase(),
        )?.[0] || "TOKEN";
      const symOut =
        Object.entries(cfg.TOKENS).find(
          ([k, v]) => v.toLowerCase() === opp.tokenOut.toLowerCase(),
        )?.[0] || "TOKEN";
      console.log(`   Path:     ${symIn} → ${symOut} → ${symIn}`);
    }

    // Amounts
    if (opp.initialAmount) {
      const decimals = getDecimals(opp.tokenIn, cfg);
      console.log(`   Input:    ${formatAmount(opp.initialAmount, decimals)}`);
    }
    if (opp.buyAmount) {
      const decimals = getDecimals(opp.tokenOut, cfg);
      console.log(`   After Buy: ${formatAmount(opp.buyAmount, decimals)}`);
    }
    if (opp.finalAmount) {
      const decimals = getDecimals(opp.tokenIn, cfg);
      console.log(`   Final:    ${formatAmount(opp.finalAmount, decimals)}`);
    }

    // DEX info
    if (opp.buyDex) console.log(`   Buy On:   ${opp.buyDex}`);
    if (opp.sellDex) console.log(`   Sell On:  ${opp.sellDex}`);

    console.log("─".repeat(60));

    // Profit details
    if (opp.profit !== undefined) {
      console.log(`   Gross Profit:  ${formatProfit(opp.profit)}`);
    }
    if (opp.premium !== undefined) {
      console.log(`   Flash Fee:     -${formatProfit(opp.premium)}`);
    }
    if (opp.gasEstimate) {
      const gasCost =
        BigInt(opp.gasEstimate) *
        (cfg?.SETTINGS?.MAX_GAS_PRICE_GWEI
          ? BigInt(Math.floor(cfg.SETTINGS.MAX_GAS_PRICE_GWEI * 1e9))
          : 0n);
      console.log(
        `   Est. Gas:      -${formatProfit(gasCost)} (${opp.gasEstimate} units)`,
      );
    }
    if (opp.netProfit !== undefined) {
      console.log("─".repeat(60));
      console.log(`   💰 NET PROFIT: ${formatProfit(opp.netProfit)}`);
    }

    console.log("═".repeat(60) + "\n");
  },
};

// Helper to get decimals for a token
function getDecimals(tokenAddress, cfg) {
  const configToUse = cfg || config;
  if (!tokenAddress || !configToUse?.TOKENS) return 18;
  const entry = Object.entries(configToUse.TOKENS).find(
    ([k, v]) => v.toLowerCase() === tokenAddress.toLowerCase(),
  );
  return entry ? configToUse.DECIMALS[entry[0]] : 18;
}

// Helper to format amounts
function formatAmount(amount, decimals = 18) {
  try {
    return ethers.formatUnits(amount, decimals);
  } catch {
    return amount.toString();
  }
}

// Helper to format profit (always in USDC decimals for display)
function formatProfit(amount) {
  try {
    const abs = amount < 0n ? -amount : amount;
    const sign = amount < 0n ? "-" : "";
    return `${sign}${ethers.formatUnits(abs, 6)} USDC`;
  } catch {
    return `${amount} wei`;
  }
}

class FlashloanBot {
  constructor(chainName = "arbitrum") {
    // Load chain config
    config = getChainConfig(chainName);
    this.chainName = chainName;

    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(config.RPC_URL);

    // Initialize wallet
    this.wallet = new ethers.Wallet(config.PRIVATE_KEY, this.provider);

    // Initialize flashloan contract
    this.flashloanContract = new ethers.Contract(
      config.FLASHLOAN_CONTRACT,
      config.FLASHLOAN_ABI,
      this.wallet,
    );

    // Initialize modules
    this.priceOracle = new PriceOracle(this.provider);
    this.arbitrageFinder = new ArbitrageFinder(this.provider, this.priceOracle);
    this.smartFinder = new SmartArbitrageFinder(
      this.provider,
      this.priceOracle,
    );

    // State
    this.isRunning = false;
    this.opportunitiesFound = 0;
    this.scansCompleted = 0;
    this.startTime = Date.now();
  }

  /**
   * Start the bot
   */
  async start() {
    console.log("\n" + "═".repeat(60));
    console.log("  🤖 FLASHLOAN ARBITRAGE BOT");
    console.log("═".repeat(60));
    console.log(`  Chain:      ${config.NAME || this.chainName}`);
    console.log(`  Network ID: ${config.CHAIN_ID}`);
    console.log(`  Contract:   ${config.FLASHLOAN_CONTRACT || "NOT SET"}`);
    console.log("─".repeat(60));
    console.log(
      `  Mode:       ${config.SETTINGS.DRY_RUN ? "🧪 DRY RUN" : "🚀 LIVE"}`,
    );
    console.log(`  Min Profit: $${config.SETTINGS.MIN_PROFIT_USD}`);
    console.log(`  Max Gas:    ${config.SETTINGS.MAX_GAS_PRICE_GWEI} Gwei`);
    console.log(`  Poll:       ${config.SETTINGS.POLL_INTERVAL_MS}ms`);
    console.log("─".repeat(60));

    // Check wallet
    const balance = await this.provider.getBalance(this.wallet.address);
    const ethBalance = ethers.formatEther(balance);
    console.log(`  Wallet:     ${this.wallet.address}`);
    console.log(`  Balance:    ${ethBalance} ETH`);
    console.log("═".repeat(60) + "\n");

    if (parseFloat(ethBalance) < 0.001) {
      logger.warn("⚠️ Low ETH balance! Fund your wallet to pay for gas.");
    }

    this.isRunning = true;
    this.startTime = Date.now();

    // Main loop
    while (this.isRunning) {
      try {
        await this.scanAndExecute();
        this.scansCompleted++;
      } catch (error) {
        logger.error("Scan error:", error.message);
      }

      // Periodic stats
      if (this.scansCompleted % 100 === 0) {
        this.printStats();
      }

      await this.sleep(config.SETTINGS.POLL_INTERVAL_MS);
    }
  }

  /**
   * Stop the bot
   */
  stop() {
    this.isRunning = false;
    this.printStats();
    logger.info("Bot stopped");
  }

  /**
   * Scan for opportunities and execute if profitable
   */
  async scanAndExecute() {
    // Check gas price
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || 0n;
    const gasPriceGwei = Number(ethers.formatUnits(gasPrice, "gwei"));

    if (gasPriceGwei > config.SETTINGS.MAX_GAS_PRICE_GWEI) {
      logger.debug(`Gas too high: ${gasPriceGwei.toFixed(3)} Gwei`);
      return;
    }

    logger.debug(`Gas OK: ${gasPriceGwei.toFixed(3)} Gwei | Scanning...`);

    // Get flashloan amount
    const flashloanAmount = BigInt(config.SETTINGS.DEFAULT_FLASHLOAN);

    // Scan for opportunities
    const smartOpps =
      await this.smartFinder.scanForOpportunities(flashloanAmount);

    // Filter and sort
    const opportunities = smartOpps
      .filter((opp) => opp.isProfitable)
      .sort((a, b) => {
        const aProfit = BigInt(a.netProfit || 0);
        const bProfit = BigInt(b.netProfit || 0);
        if (aProfit > bProfit) return -1;
        if (aProfit < bProfit) return 1;
        return 0;
      });

    if (opportunities.length === 0) {
      logger.debug("No profitable opportunities");
      return;
    }

    // Log the opportunities
    this.opportunitiesFound += opportunities.length;
    logger.info(`Found ${opportunities.length} opportunity(ies)!`);

    // Log each opportunity with details
    for (const opp of opportunities.slice(0, 3)) {
      // Show top 3
      logger.opportunity(opp);
    }

    // Execute the best one if not in dry run
    if (!config.SETTINGS.DRY_RUN && opportunities.length > 0) {
      await this.executeArbitrage(opportunities[0], gasPrice);
    } else if (config.SETTINGS.DRY_RUN) {
      logger.info("🏃 DRY RUN - Skipping execution");
    }
  }

  /**
   * Execute an arbitrage trade
   */
  async executeArbitrage(opportunity, gasPrice) {
    logger.warn("🚀 EXECUTING ARBITRAGE...");

    try {
      // Build params
      const arbParams = this.arbitrageFinder.buildArbitrageParams(opportunity);

      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        [
          "tuple(tuple(uint8 dexType, address router, address[] path, uint256 fee, uint256 amountOutMin) leg1, tuple(uint8 dexType, address router, address[] path, uint256 fee, uint256 amountOutMin) leg2, address profitRecipient)",
        ],
        [
          {
            leg1: arbParams.leg1,
            leg2: arbParams.leg2,
            profitRecipient: this.wallet.address,
          },
        ],
      );

      // Estimate gas
      const gasEstimate = await this.flashloanContract.loan.estimateGas(
        opportunity.tokenIn || config.TOKENS.USDC,
        opportunity.initialAmount || BigInt(config.SETTINGS.DEFAULT_FLASHLOAN),
        params,
      );

      // Execute
      const tx = await this.flashloanContract.loan(
        opportunity.tokenIn || config.TOKENS.USDC,
        opportunity.initialAmount || BigInt(config.SETTINGS.DEFAULT_FLASHLOAN),
        params,
        {
          gasLimit: (gasEstimate * 120n) / 100n,
          gasPrice: gasPrice,
        },
      );

      logger.warn(`📤 TX Sent: ${tx.hash}`);

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        logger.info(`✅ TX Confirmed in block ${receipt.blockNumber}`);
        logger.info(`   Gas Used: ${receipt.gasUsed.toString()}`);
      } else {
        logger.error("❌ TX Failed");
      }
    } catch (error) {
      logger.error("❌ Execution failed:", error.message);
    }
  }

  /**
   * Print statistics
   */
  printStats() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    console.log("\n" + "─".repeat(40));
    console.log("📊 Statistics");
    console.log(`   Uptime: ${hours}h ${minutes}m`);
    console.log(`   Scans: ${this.scansCompleted}`);
    console.log(`   Opportunities: ${this.opportunitiesFound}`);
    console.log("─".repeat(40) + "\n");
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = FlashloanBot;
