# Flashloan Metrics Dashboard

Simple Next.js dashboard to view all feasible opportunities logged by the bot.

## Setup

1. Start Postgres: from repo root `docker compose up -d`
2. Copy env: `cp .env.example .env` (set DATABASE_URL if different)
3. Install deps: `npm install`
4. Run dev: `npm run dev` (http://localhost:3000)
5. Run bot with DB logging: in `bot/`, copy `.env.example` to `.env` and ensure DATABASE_URL set, then run bot. Opportunities will appear in dashboard.

Tables store: mode (dryrun/live), chain, pair/dexes, flashloan amount, profit/premium/gas/net profit, simulated/executed, tx_hash, raw json.
