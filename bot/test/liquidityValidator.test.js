// Tests for pool-liquidity validation.
//
// The validator reads the pool's own on-chain state (factory -> pool ->
// liquidity/slot0/reserves). We inject a fake contract factory so no RPC is
// needed, and pin the fail-closed behaviour: an unverifiable pool is NOT
// tradeable.

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

// A pool stub with a human spot price of ~1.0 (token1/token0) and given
// liquidity. token0 has `dec0` decimals, token1 `dec1`; the raw price at a
// human 1:1 is 10^(dec1-dec0), so sqrtPriceX96 = sqrt(raw) * 2^96.
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

test("V3 pool with enough liquidity and tiny impact is tradeable", async () => {
  const v = makeValidator({ v3Pool: poolAt1({ liquidity: 10n ** 18n }) });
  v._decimals = async (t) => (t === "0xUSDC" ? 6 : 18);
  // 10000 USDC (6 dec) -> 9999.5 DAI (18 dec): impact ~5 bps, under 200.
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
  // Impact is exactly zero (10000 -> 10000, same decimals), so ONLY the
  // dust-liquidity floor can reject this pool. This pins the minimum-depth
  // check independently of the price-impact check.
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
  // 10000 USDC -> 398 DAI: impact ~96%, way over 200 bps.
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

test("priceImpactBps computes the expected value", () => {
  // spot 1.0, effective 0.99995 -> 0.5 bps
  const bps = LiquidityValidator.priceImpactBps(
    10000n * 10n ** 6n,
    99995n * 10n ** 17n,
    6,
    18,
    1.0,
  );
  assert.ok(Math.abs(bps - 0.5) < 0.01, `expected ~0.5 bps, got ${bps}`);
});

test("priceImpactBps returns null on zero input", () => {
  assert.strictEqual(
    LiquidityValidator.priceImpactBps(0n, 1n, 6, 18, 1.0),
    null,
  );
  assert.strictEqual(LiquidityValidator.priceImpactBps(1n, 1n, 6, 18, 0), null);
});

test("V2 pair with enough reserves is accepted", async () => {
  const v = makeValidator({
    v2Pair: { getReserves: async () => [10n ** 18n, 10n ** 18n] },
  });
  assert.strictEqual(
    await v.hasV2Liquidity("SUSHISWAP", "0xUSDC", "0xDAI"),
    true,
  );
});

test("V2 pair with dust reserves is rejected", async () => {
  const v = makeValidator({ v2Pair: { getReserves: async () => [31n, 31n] } });
  assert.strictEqual(
    await v.hasV2Liquidity("SUSHISWAP", "0xUSDC", "0xDAI"),
    false,
  );
});

test("V2 one-sided dust reserve is rejected", async () => {
  const v = makeValidator({
    v2Pair: { getReserves: async () => [10n ** 18n, 5n] },
  });
  assert.strictEqual(
    await v.hasV2Liquidity("SUSHISWAP", "0xUSDC", "0xDAI"),
    false,
  );
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
