# Flashloan Arbitrage Bot

Multi-chain flashloan arbitrage bot for Ethereum L2s (Arbitrum, Base).

## Project Structure

```
flashloan-bot/
├── contracts/           # Smart contracts (Foundry)
│   ├── src/            # Contract sources
│   ├── test/           # Contract tests
│   ├── script/         # Deployment scripts
│   ├── foundry.toml    # Foundry configuration
│   └── remappings.txt  # Import remappings
│
├── bot/                 # Arbitrage bot (Node.js)
│   ├── src/            # Bot source code
│   │   ├── index.js    # Entry point
│   │   ├── chains.js   # Multi-chain configuration
│   │   └── ...
│   ├── config/         # Chain configurations
│   ├── scripts/        # Utility scripts
│   └── ecosystem.config.js  # PM2 config
│
├── deploy/              # Deployment scripts & env
│   ├── deploy.sh       # Arbitrum deployment
│   ├── deploy-base.sh  # Base deployment
│   └── .env.example    # Environment template
│
├── docs/                # Documentation
│   ├── AGENTS.md       # Agent coding guidelines
│   └── ...
│
└── logs/                # Bot logs (gitignored)
```

## Quick Start

### 1. Install Dependencies

```bash
# Contracts (Foundry)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Bot
cd bot && npm install
```

### 2. Deploy Contract

```bash
# Arbitrum
cd deploy && cp .env.example .env
# Edit .env with your private key
./deploy.sh

# Base
./deploy-base.sh
```

### 3. Run Bot

```bash
# Run on Arbitrum
cd bot && npm start arbitrum

# Run on Base
cd bot && npm start base

# Dry run (no real trades)
DRY_RUN=true npm start base
```

## Supported Chains

| Chain | Status | Main DEXes |
|-------|--------|------------|
| Arbitrum | ✅ | Camelot, SushiSwap, Uniswap V3 |
| Base | ✅ | Aerodrome, SushiSwap, Uniswap V3 |

## Documentation

- [Agent Guidelines](docs/AGENTS.md)
- [PM2 Deployment](docs/PM2.md)

## ⚠️ Disclaimer

This is for educational purposes. Flashloan arbitrage is highly competitive. Use at your own risk.

## Metrics DB & Dashboard

- Start DB: `docker compose up -d` (Postgres on 5432)
- Bot auto-logs feasible opportunities to Postgres (mode dryrun/live, simulated gains for dryrun)
- Dashboard: `cd dashboard && npm install && npm run dev` → http://localhost:3000
