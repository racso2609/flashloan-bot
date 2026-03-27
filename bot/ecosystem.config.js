// PM2 Ecosystem configuration for Flashloan Arbitrage Bot
// Usage (from bot/ directory):
//   pm2 start ecosystem.config.js                    # Default (arbitrum)
//   pm2 start ecosystem.config.js -- arbitrum        # Arbitrum
//   pm2 start ecosystem.config.js -- base            # Base
//   pm2 start ecosystem.config.js --env production   # Production mode
//   pm2 stop flashloan-bot
//   pm2 restart flashloan-bot
//   pm2 logs flashloan-bot --lines 100
//   pm2 monit

module.exports = {
  apps: [
    {
      name: "flashloan-arbitrum",
      script: "./src/index.js",
      cwd: "./",
      args: "arbitrum",
      
      env: {
        NODE_ENV: "development",
        CHAIN: "arbitrum",
        DRY_RUN: "true",
        LOG_LEVEL: "debug",
      },
      
      env_production: {
        NODE_ENV: "production",
        CHAIN: "arbitrum",
        DRY_RUN: "false",
        LOG_LEVEL: "info",
      },
      
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      
      error_file: "./logs/arbitrum-error.log",
      out_file: "./logs/arbitrum-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
    },
    
    {
      name: "flashloan-base",
      script: "./src/index.js",
      cwd: "./",
      args: "base",
      
      env: {
        NODE_ENV: "development",
        CHAIN: "base",
        DRY_RUN: "true",
        LOG_LEVEL: "debug",
      },
      
      env_production: {
        NODE_ENV: "production",
        CHAIN: "base",
        DRY_RUN: "false",
        LOG_LEVEL: "info",
      },
      
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      
      error_file: "./logs/base-error.log",
      out_file: "./logs/base-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
    },
  ],
};
