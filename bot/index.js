// Entry point for the flashloan arbitrage bot
const { configDotenv } = require("dotenv");
const FlashloanBot = require("./flashloanBot");
configDotenv();

// Handle graceful shutdown
let bot;

async function main() {
  bot = new FlashloanBot();

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n\nReceived SIGINT, shutting down gracefully...");
    if (bot) {
      bot.stop();
    }
    process.exit(0);
  });

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    if (bot) {
      bot.stop();
    }
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled rejection at:", promise, "reason:", reason);
  });

  // Start the bot
  await bot.start();
}

// Run if called directly
// if (require.main === module) {
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
// }

module.exports = { FlashloanBot, main };
