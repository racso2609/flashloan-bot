// PM2 Ecosystem configuration for Flashloan Arbitrage Bot
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 start ecosystem.config.js --env production
//   pm2 stop flashloan-bot
//   pm2 restart flashloan-bot
//   pm2 logs flashloan-bot
//   pm2 monit

module.exports = {
  apps: [
    {
      // Bot application
      name: "flashloan-bot",
      script: "./index.js",
      cwd: "./",

      // Environment variables
      env: {
        NODE_ENV: "development",
        DRY_RUN: "true",
        LOG_LEVEL: "debug",
      },

      env_production: {
        NODE_ENV: "production",
        DRY_RUN: "false",
        LOG_LEVEL: "info",
      },

      // Instance management
      instances: 1, // Run single instance (bot needs sequential execution)
      autorestart: true, // Auto restart on crash
      watch: false, // Don't watch files (disable in production)
      max_memory_restart: "500M", // Restart if memory exceeds 500MB

      // Logging
      error_file: "./logs/bot-error.log",
      out_file: "./logs/bot-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Restart policy
      min_uptime: "10s", // Consider started after 10s
      max_restarts: 10, // Max restarts within restart window
      restart_delay: 5000, // Delay between restarts (5s)

      // Exponential backoff restart
      exp_backoff_restart_delay: 100,

      // Kill timeout
      kill_timeout: 5000, // Time to wait before force killing

      // Input handling
      listen_timeout: 8000, // Time to wait for app to start
      shutdown_with_message: true, // Allow graceful shutdown via PM2 messaging

      // Cron restart (optional - restart daily at 4 AM)
      // cron_restart: '0 4 * * *',

      // Source map support
      source_map_support: true,

      // Increment PID file
      increment_var: "PORT",

      // Environment file
      env_file: ".env", // Uncomment to use .env file
    },
  ],

  // Deployment configuration (optional - for PM2 deploy)
  deploy: {
    production: {
      user: "node",
      host: ["your-server.com"],
      ref: "origin/main",
      repo: "git@github.com:yourusername/flashloan-bot.git",
      path: "/var/www/flashloan-bot",
      "pre-deploy": "git fetch --all",
      "post-deploy":
        "npm install && pm2 reload ecosystem.config.js --env production",
      "pre-setup": "mkdir -p /var/www/flashloan-bot/logs",
    },
  },
};
