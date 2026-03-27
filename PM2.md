# Flashloan Bot - PM2 Management Scripts

## Quick Start

```bash
# Start the bot in development (dry-run mode)
pm2 start ecosystem.config.js

# Start the bot in production mode
pm2 start ecosystem.config.js --env production

# Start with custom environment
NODE_ENV=production DRY_RUN=false pm2 start ecosystem.config.js
```

## Monitoring

```bash
# View real-time logs
pm2 logs flashloan-bot

# View logs with timestamp
pm2 logs flashloan-bot --timestamp

# View only error logs
pm2 logs flashloan-bot --err

# Monitor CPU and Memory
pm2 monit
```

## Management

```bash
# Stop the bot
pm2 stop flashloan-bot

# Restart the bot
pm2 restart flashloan-bot

# Reload with zero downtime (not applicable for single instance)
pm2 reload flashloan-bot

# Delete the bot from PM2
pm2 delete flashloan-bot

# List all processes
pm2 list
```

## Configuration

```bash
# View current config
pm2 show flashloan-bot

# Update environment variables
pm2 env flashloan-bot

# Save current process list (survives reboot)
pm2 save

# Restore saved process list
pm2 resurrect

# Generate startup script (for auto-start on boot)
pm2 startup
# Then run the command it outputs
```

## Troubleshooting

```bash
# View detailed info
pm2 describe flashloan-bot

# Get memory dump
pm2 memdump flashloan-bot

# Force stop all PM2 processes
pm2 kill

# Restart PM2 daemon
pm2 resurrect
```

## Log Rotation (Recommended)

Install log rotation:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```
