# Flashloan Arbitrage Bot

Off-chain bot that monitors DEX prices and executes flashloan arbitrage opportunities.

## How It Works

```
1. Bot polls prices from Uniswap V2, SushiSwap, Uniswap V3
2. Compares prices across DEXes for configured trading pairs
3. Calculates profitability (accounting for flashloan premium + gas)
4. If profitable, encodes ArbitrageParams and sends flashloan tx
5. Contract executes swaps atomically and repays loan
```

## Setup

```bash
# Install dependencies
cd bot
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your RPC URL, private key, and contract address
```

## Usage

```bash
# Dry run (no actual trades, just logs opportunities)
npm run dry-run

# Live trading
npm start
```

## Configuration

Edit `config.js` to:
- Add/remove trading pairs
- Add/remove DEXes
- Adjust min profit threshold
- Set max gas price
- Configure flashloan amount

## Security

⚠️ **NEVER commit your `.env` file or private key!**

- Use a dedicated wallet with limited funds
- Test with DRY_RUN=true first
- Monitor gas prices to avoid unprofitable trades
