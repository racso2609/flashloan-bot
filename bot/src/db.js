const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://flashloan:flashloan@localhost:5432/flashloan_metrics',
  max: 10,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunities (
      id SERIAL PRIMARY KEY,
      chain TEXT,
      mode TEXT,
      type TEXT,
      pair TEXT,
      direction TEXT,
      buy_dex TEXT,
      sell_dex TEXT,
      token_in TEXT,
      token_out TEXT,
      flashloan_amount TEXT,
      profit TEXT,
      premium TEXT,
      gas_cost_token TEXT,
      gas_cost_native TEXT,
      net_profit TEXT,
      net_profit_usd_simulated TEXT,
      simulated BOOLEAN DEFAULT true,
      executed BOOLEAN DEFAULT false,
      tx_hash TEXT,
      error TEXT,
      raw_json JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_opps_chain_created ON opportunities(chain, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_opps_mode ON opportunities(mode);
  `);
}

async function logOpportunity(opp, ctx = {}) {
  try {
    await pool.query(
      `INSERT INTO opportunities(
        chain, mode, type, pair, direction, buy_dex, sell_dex, token_in, token_out,
        flashloan_amount, profit, premium, gas_cost_token, gas_cost_native, net_profit,
        net_profit_usd_simulated, simulated, executed, tx_hash, error, raw_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [
        ctx.chain || null,
        ctx.mode || (ctx.dryRun ? 'dryrun' : 'live'),
        opp.type || null,
        opp.pair || null,
        opp.direction || null,
        opp.buyDex || opp.buyDEX || null,
        opp.sellDex || opp.sellDEX || null,
        opp.tokenIn || null,
        opp.tokenOut || null,
        (opp.initialAmount || opp.flashloanAmount || null)?.toString?.() || null,
        opp.profit?.toString?.() || null,
        opp.premium?.toString?.() || null,
        opp.gasCost?.toString?.() || opp.gasCostToken?.toString?.() || null,
        opp.gasCostNative?.toString?.() || null,
        opp.netProfit?.toString?.() || null,
        ctx.netProfitUsdSimulated || null,
        ctx.simulated !== false,
        ctx.executed === true,
        ctx.txHash || null,
        ctx.error || null,
        JSON.stringify({
          ...opp,
          profit: opp.profit?.toString?.(),
          premium: opp.premium?.toString?.(),
          netProfit: opp.netProfit?.toString?.(),
          gasCost: opp.gasCost?.toString?.(),
        }),
      ]
    );
  } catch (e) {
    console.error('[DB] Failed to log opportunity:', e.message);
  }
}

module.exports = { pool, init, logOpportunity };
