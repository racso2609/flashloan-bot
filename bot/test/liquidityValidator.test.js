// Tests for pool-liquidity validation.
//
// The validator reads the pool's own on-chain state (factory -> pool ->
// liquidity/slot0/reserves). We inject a fake contract factory so no RPC is
// needed, and pin both the fail-closed behaviour and the fact that the dust
// floor is decimal-agnostic (it must not reject real stablecoin pools).

const test = require("node:test");
const assert = require("node:assert");
const {
  LiquidityValidator,
  DEFAULT_MAX_PRICE_IMPACT_BPS,
  ZERO_ADDRESS,
} = require("../src/liquidityValidator");

// Build a validator whose contract factory returns stubs by address.
function makeValidator({ v3Pool, v2Pair, decimals = {} } = {}) {
  const contractFactory = (address, abi) => {
    const a = String(address).toLowerCase();
    if (a === "0xpool" && v3Pool) return v3Pool;
    if (a === "0xpair" && v2Pair) return v2Pair;
    if (decimals[a] !== undefined)
      return { decimals: async () => BigInt(decimals[a]) };
    throw new Error(`unexpected contract ${address}`);
  };
  const v = new LiquidityValidator(
    {},
    { DEX_FACTORIES: {} },
    { contractFactory },
  );
  v.v3Factory = { getPool: async () => (v3Pool ? "0xPOOL" : ZERO_ADDRESS) };
  v.v2Factories = {
    SUSHISWAP: { getPair: async () => (v2Pair ? "0xPAIR" : ZERO_ADDRESS) },
  };
  return v;
}

// A V3 pool stub with a human spot price of ~1.0 (token1/token0).
function poolAt1({
  liquidity = 10n ** 18n,
  token0 = "0xUSDC",
  dec0 = 6,
  dec1 = 18,
} = {}) {
  const rawPrice = 10 ** (dec1 - dec0);
  const sqrtPriceX96 =
    BigInt(Math.round(Math.sqrt(rawPrice) * 2 ** 48)) * 2n ** 48n;
  return {
    liquidity: async () => liquidity,
    slot0: async () => [sqrtPriceX96, 0, 0, 0, 0, 0, true],
    token0: async () => token0,
    token1: async () => "0xDAI",
  };
}

// A V2 pair stub with given human reserves on both sides (6-dec tokens).
function pair6({ reserveHuman = 5_000_000n } = {}) {
  const raw = reserveHuman * 10n ** 6n;
  return {
    getReserves: async () => [raw, raw],
    token0: async () => "0xUSDC",
    token1: async () => "0xUSDT",
  };
}

test("V3 pool with enough liquidity and tiny impact is tradeable", async () => {
  const v = makeValidator({ v3Pool: poolAt1({ liquidity: 10n ** 18n }) });
  v._decimals = async (t) => (t === "0xUSDC" ? 6 : 18);
  const ok = await v.isV3Tradeable(
    "0xUSDC",
    "0xDAI",
    100,
    10000n * 10n ** 6n,
    99995n * 10n ** 17n,
    6,
    18,
  );
  assert.strictEqual(ok, true);
});

test("V3 pool with dust liquidity is rejected", async () => {
  const v = makeValidator({ v3Pool: poolAt1({ liquidity: 1n }) });
  v._decimals = async (t) => (t === "0xUSDC" ? 6 : 18);
  const ok = await v.isV3Tradeable(
    "0xUSDC",
    "0xDAI",
    100,
    10000n * 10n ** 6n,
    10000n * 10n ** 6n,
    6,
    6,
  );
  assert.strictEqual(ok, false);
});

test("V3 missing pool (address(0)) is rejected", async () => {
  const v = makeValidator({});
  assert.strictEqual(
    await v.isV3Tradeable("0xUSDC", "0xDAI", 100, 1n, 1n, 6, 18),
    false,
  );
});

test("V3 pool with excessive price impact is rejected", async () => {
  const v = makeValidator({ v3Pool: poolAt1({ liquidity: 10n ** 18n }) });
  v._decimals = async (t) => (t === "0xUSDC" ? 6 : 18);
  const ok = await v.isV3Tradeable(
    "0xUSDC",
    "0xDAI",
    500,
    10000n * 10n ** 6n,
    398n * 10n ** 18n,
    6,
    18,
  );
  assert.strictEqual(ok, false);
});

test("V3 probe failure is fail-closed", async () => {
  const v = makeValidator({ v3Pool: poolAt1() });
  v.v3Factory = {
    getPool: async () => {
      throw new Error("rpc down");
    },
  };
  assert.strictEqual(
    await v.isV3Tradeable("0xUSDC", "0xDAI", 100, 1n, 1n, 6, 18),
    false,
  );
});

test("V3 uncomputable spot is fail-closed when a quote is supplied", async () => {
  // slot0 reverts -> spotPrice null. A quote with ~96% impact must NOT pass.
  const v = makeValidator({
    v3Pool: {
      liquidity: async () => 10n ** 20n,
      slot0: async () => {
        throw new Error("revert");
      },
      token0: async () => "0xUSDC",
      token1: async () => "0xDAI",
    },
  });
  v._decimals = async (t) => (t === "0xUSDC" ? 6 : 18);
  const ok = await v.isV3Tradeable(
    "0xUSDC",
    "0xDAI",
    500,
    10000n * 10n ** 6n,
    398n * 10n ** 18n,
    6,
    18,
  );
  assert.strictEqual(
    ok,
    false,
    "unverifiable spot must not let a phantom through",
  );
});

test("V3 sqrtPriceX96 == 0 is fail-closed", async () => {
  const v = makeValidator({
    v3Pool: {
      liquidity: async () => 10n ** 20n,
      slot0: async () => [0n, 0, 0, 0, 0, 0, true],
      token0: async () => "0xUSDC",
      token1: async () => "0xDAI",
    },
  });
  v._decimals = async (t) => (t === "0xUSDC" ? 6 : 18);
  const ok = await v.isV3Tradeable(
    "0xUSDC",
    "0xDAI",
    500,
    10000n * 10n ** 6n,
    9999n * 10n ** 18n,
    6,
    18,
  );
  assert.strictEqual(ok, false);
});

test("existence-only probe (no quote) does not require a spot price", async () => {
  const v = makeValidator({
    v3Pool: {
      liquidity: async () => 10n ** 18n,
      slot0: async () => {
        throw new Error("revert");
      },
      token0: async () => "0xUSDC",
      token1: async () => "0xDAI",
    },
  });
  // No amountIn/amountOut -> only existence + dust is checked.
  assert.strictEqual(await v.isV3Tradeable("0xUSDC", "0xDAI", 500), true);
});

test("priceImpactBps computes the expected value", () => {
  const bps = LiquidityValidator.priceImpactBps(
    10000n * 10n ** 6n,
    99995n * 10n ** 17n,
    6,
    18,
    1.0,
  );
  assert.ok(Math.abs(bps - 0.5) < 0.01, `expected ~0.5 bps, got ${bps}`);
});

test("priceImpactBps returns null on zero input or non-finite spot", () => {
  assert.strictEqual(
    LiquidityValidator.priceImpactBps(0n, 1n, 6, 18, 1.0),
    null,
  );
  assert.strictEqual(
    LiquidityValidator.priceImpactBps(1n, 0n, 6, 18, 1.0),
    null,
  );
  assert.strictEqual(
    LiquidityValidator.priceImpactBps(1n, 1n, 6, 18, Infinity),
    null,
  );
  assert.strictEqual(LiquidityValidator.priceImpactBps(1n, 1n, 6, 18, 0), null);
});

test("priceImpactBps fails closed on Number() overflow", () => {
  // A BigInt far beyond Number.MAX_VALUE becomes Infinity; the ratio would be
  // NaN and slip past the check. Must return null (fail-closed).
  const huge = 10n ** 400n;
  assert.strictEqual(
    LiquidityValidator.priceImpactBps(huge, 1n, 0, 0, 1.0),
    null,
  );
  assert.strictEqual(
    LiquidityValidator.priceImpactBps(1n, huge, 0, 0, 1.0),
    null,
  );
});

test("V2 pair with realistic stablecoin reserves is accepted (decimal-agnostic)", async () => {
  // 5M USDC/USDT (6 dec) = 5e12 raw, far below the old 1e15 raw floor. Must pass.
  const v = makeValidator({ v2Pair: pair6({ reserveHuman: 5_000_000n }) });
  v._decimals = async () => 6;
  assert.strictEqual(
    await v.hasV2Liquidity("SUSHISWAP", "0xUSDC", "0xUSDT"),
    true,
  );
});

test("V2 pair with dust reserves is rejected", async () => {
  const v = makeValidator({
    v2Pair: {
      getReserves: async () => [31n, 31n],
      token0: async () => "0xUSDC",
      token1: async () => "0xUSDT",
    },
  });
  v._decimals = async () => 6;
  assert.strictEqual(
    await v.hasV2Liquidity("SUSHISWAP", "0xUSDC", "0xUSDT"),
    false,
  );
});

test("V2 excessive price impact is rejected", async () => {
  const v = makeValidator({ v2Pair: pair6({ reserveHuman: 5_000_000n }) });
  v._decimals = async () => 6;
  // 10000 USDC -> 398 USDT: ~96% impact.
  const ok = await v.isV2Tradeable(
    "SUSHISWAP",
    "0xUSDC",
    "0xUSDT",
    10000n * 10n ** 6n,
    398n * 10n ** 6n,
    6,
    6,
  );
  assert.strictEqual(ok, false);
});

test("V2 pair whose tokens do not match the traded pair is fail-closed", async () => {
  // tokenIn/tokenOut are not the pair's tokens -> no meaningful spot -> reject
  // rather than silently treating the trade as safe.
  const v = makeValidator({ v2Pair: pair6({ reserveHuman: 5_000_000n }) });
  v._decimals = async () => 6;
  const ok = await v.isV2Tradeable(
    "SUSHISWAP",
    "0xDAI",
    "0xUSDT",
    10000n * 10n ** 6n,
    9999n * 10n ** 6n,
    6,
    6,
  );
  assert.strictEqual(ok, false);
});

test("V2 tiny price impact is accepted", async () => {
  const v = makeValidator({ v2Pair: pair6({ reserveHuman: 5_000_000n }) });
  v._decimals = async () => 6;
  // 10000 USDC -> 9999 USDT: ~1 bps impact.
  const ok = await v.isV2Tradeable(
    "SUSHISWAP",
    "0xUSDC",
    "0xUSDT",
    10000n * 10n ** 6n,
    9999n * 10n ** 6n,
    6,
    6,
  );
  assert.strictEqual(ok, true);
});

test("results are cached (second call does not re-probe)", async () => {
  let poolCalls = 0;
  const v = makeValidator({ v3Pool: poolAt1({ liquidity: 10n ** 18n }) });
  v.v3Factory = {
    getPool: async () => {
      poolCalls++;
      return "0xPOOL";
    },
  };
  v._decimals = async () => 6;
  await v.isV3Tradeable(
    "0xUSDC",
    "0xDAI",
    100,
    10000n * 10n ** 6n,
    9999n * 10n ** 6n,
    6,
    6,
  );
  await v.isV3Tradeable(
    "0xUSDC",
    "0xDAI",
    100,
    10000n * 10n ** 6n,
    9999n * 10n ** 6n,
    6,
    6,
  );
  assert.strictEqual(poolCalls, 1, "second call must hit the cache");
});

test("no factory configured -> cannot validate -> permissive", async () => {
  const v = new LiquidityValidator({}, { DEX_FACTORIES: {} });
  assert.strictEqual(
    await v.isV3Tradeable("0xA", "0xB", 500, 1n, 1n, 6, 6),
    true,
  );
  assert.strictEqual(await v.hasV2Liquidity("SUSHISWAP", "0xA", "0xB"), true);
});

test("default max price impact is 2%", () => {
  assert.strictEqual(DEFAULT_MAX_PRICE_IMPACT_BPS, 200n);
});
