// Test for the V3 price computation bug.
//
// getTokenDecimals returns a BigInt (ethers decimals() is uint8 -> bigint).
// The old code did `10 ** tokenInDecimals`, which throws
// "Cannot mix BigInt and other types" and was swallowed by the catch, so every
// V3 quote silently returned 0n. This test pins the fix: a quote with BigInt
// decimals must produce a non-zero amountOut and a sane price.

const test = require("node:test");
const assert = require("node:assert");
const PriceOracle = require("../src/priceOracle");

// Minimal provider stub: only what PriceOracle touches in this path.
function stubProvider() {
  return {
    call: async () => "0x",
  };
}

// Build an oracle whose quoter returns a fixed amount, and whose decimals are
// BigInt (as ethers does), without hitting the network.
function makeOracle(amountOut, decIn, decOut) {
  const oracle = new PriceOracle(stubProvider(), {
    DEX_ROUTERS: {
      UNISWAP_V3_QUOTER: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
    },
  });
  // Replace the quoter with a stub returning a fixed amount.
  oracle.v3Quoter = {
    quoteExactInputSingle: {
      staticCall: async () => amountOut,
    },
  };
  oracle.getTokenDecimals = async (addr) => (addr === "0xIN" ? decIn : decOut);
  return oracle;
}

test("V3 quote returns a non-zero amount and a finite price with BigInt decimals", async () => {
  // 10000 USDC (6 dec) -> 9998 USDC_E (6 dec)
  const oracle = makeOracle(9998n * 10n ** 6n, 6n, 6n);
  const r = await oracle.getPriceV3("0xIN", "0xOUT", 100, 10000n * 10n ** 6n);
  assert.strictEqual(r.amountOut, 9998n * 10n ** 6n);
  assert.ok(Number.isFinite(r.price), "price must be a finite number");
  assert.ok(r.price > 0.99 && r.price < 1.01, `price ~1, got ${r.price}`);
});

test("V3 quote handles differing decimals (6 -> 18)", async () => {
  // 10000 USDC (6) -> 0.003 WETH (18): price should reflect the 1e12 scaling.
  const oracle = makeOracle(3n * 10n ** 15n, 6n, 18n);
  const r = await oracle.getPriceV3("0xIN", "0xOUT", 500, 10000n * 10n ** 6n);
  assert.strictEqual(r.amountOut, 3n * 10n ** 15n);
  assert.ok(Number.isFinite(r.price), "price must not be NaN/Infinity");
});

test("V3 quote returns 0n on a reverting quoter (unchanged behaviour)", async () => {
  const oracle = makeOracle(0n, 6n, 6n);
  oracle.v3Quoter.quoteExactInputSingle.staticCall = async () => {
    throw new Error("execution reverted");
  };
  const r = await oracle.getPriceV3("0xIN", "0xOUT", 500, 10000n * 10n ** 6n);
  assert.strictEqual(r.amountOut, 0n);
});

test("V3 quote is rejected when the pool is not tradeable", async () => {
  const oracle = makeOracle(9998n * 10n ** 6n, 6n, 6n);
  // Inject a validator that reports the pool as untradeable.
  oracle.liquidityValidator = { isV3Tradeable: async () => false };
  const r = await oracle.getPriceV3("0xIN", "0xOUT", 500, 10000n * 10n ** 6n);
  assert.strictEqual(r.amountOut, 0n, "untradeable pool must yield no quote");
});

test("V2 quote is rejected when the pool has no liquidity", async () => {
  const oracle = makeOracle(0n, 6n, 6n);
  // Router returns a NON-zero quote, so only the liquidity guard can stop it.
  oracle.routers = {
    SUSHISWAP: {
      getAmountsOut: {
        staticCall: async () => [10000n * 10n ** 6n, 9999n * 10n ** 6n],
      },
    },
  };
  oracle.liquidityValidator = {
    hasV2Liquidity: async () => false,
    isV2Tradeable: async () => false,
  };
  const r = await oracle.getPriceV2(
    "SUSHISWAP",
    "0xIN",
    "0xOUT",
    10000n * 10n ** 6n,
  );
  assert.strictEqual(r.amountOut, 0n, "illiquid pool must yield no quote");
});

test("V2 quote is rejected when the pool is too shallow for the trade", async () => {
  const oracle = makeOracle(0n, 6n, 6n);
  // Pair exists (hasV2Liquidity true) but the trade has excessive impact
  // (isV2Tradeable false). Only the impact gate can stop this quote.
  oracle.routers = {
    SUSHISWAP: {
      getAmountsOut: {
        staticCall: async () => [10000n * 10n ** 6n, 398n * 10n ** 6n],
      },
    },
  };
  oracle.liquidityValidator = {
    hasV2Liquidity: async () => true,
    isV2Tradeable: async () => false,
  };
  const r = await oracle.getPriceV2(
    "SUSHISWAP",
    "0xIN",
    "0xOUT",
    10000n * 10n ** 6n,
  );
  assert.strictEqual(r.amountOut, 0n, "excessive impact must yield no quote");
});

test("V2 quote passes through when the pool is liquid", async () => {
  const oracle = makeOracle(0n, 6n, 6n);
  oracle.routers = {
    SUSHISWAP: {
      getAmountsOut: {
        staticCall: async () => [10000n * 10n ** 6n, 9999n * 10n ** 6n],
      },
    },
  };
  oracle.liquidityValidator = {
    hasV2Liquidity: async () => true,
    isV2Tradeable: async () => true,
  };
  const r = await oracle.getPriceV2(
    "SUSHISWAP",
    "0xIN",
    "0xOUT",
    10000n * 10n ** 6n,
  );
  assert.strictEqual(
    r.amountOut,
    9999n * 10n ** 6n,
    "liquid pool must yield a quote",
  );
});

test("V2 quote returns a non-zero price with BigInt decimals", async () => {
  // Same BigInt-decimals bug as V3, but on the V2 path: `10 ** tokenInDecimals`
  // used to throw and be swallowed, leaving price at 0. Pin the fix.
  const oracle = makeOracle(0n, 6n, 6n);
  oracle.routers = {
    SUSHISWAP: {
      getAmountsOut: {
        staticCall: async () => [10000n * 10n ** 6n, 9999n * 10n ** 6n],
      },
    },
  };
  oracle.liquidityValidator = {
    hasV2Liquidity: async () => true,
    isV2Tradeable: async () => true,
  };
  const r = await oracle.getPriceV2(
    "SUSHISWAP",
    "0xIN",
    "0xOUT",
    10000n * 10n ** 6n,
  );
  assert.strictEqual(r.amountOut, 9999n * 10n ** 6n);
  assert.ok(
    Number.isFinite(r.price) && r.price > 0,
    `price must be > 0, got ${r.price}`,
  );
  assert.ok(r.price > 0.99 && r.price < 1.01, `price ~1, got ${r.price}`);
});
