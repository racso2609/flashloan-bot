// Integration tests: the validation actually changes smartFinder's output.
//
// We stub the price oracle so no RPC is needed.

const test = require("node:test");
const assert = require("node:assert");
const SmartArbitrageFinder = require("../src/smartFinder");

// Minimal oracle stub: returns a fixed set of routes per directed pair.
function stubOracle(routesByPair) {
  const venues = new Set();
  for (const r of Object.values(routesByPair)) {
    for (const v of Object.keys(r)) venues.add(v);
  }
  const routers = {};
  for (const v of venues) routers[v] = {};

  return {
    routers,
    v3Quoter: null,
    async getPriceV2(dexName, tokenIn, tokenOut) {
      const key = `${tokenIn}>${tokenOut}`;
      const r = routesByPair[key];
      if (!r || !(dexName in r)) return { amountOut: 0n, price: 0 };
      return { amountOut: BigInt(r[dexName]), price: 0 };
    },
    async getPriceV3() {
      return { amountOut: 0n, price: 0 };
    },
  };
}

const chainConfig = {
  tokens: { USDC: "0xUSDC", USDT: "0xUSDT", WETH: "0xWETH" },
  SETTINGS: { DEFAULT_FLASHLOAN: "10000000" },
};

test("findBestRoute returns all routes (liquidity filtering happens in the oracle)", async () => {
  // smartFinder no longer filters by quote magnitude: the oracle already drops
  // pools without liquidity. Every route reaching here is tradeable.
  const oracle = stubOracle({
    "0xUSDC>0xUSDT": { SUSHISWAP: 9990, CAMELOT: 10010 },
    "0xUSDT>0xUSDC": { SUSHISWAP: 9990, CAMELOT: 10010 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const routes = await finder.findBestRoute("0xUSDC", "0xUSDT", 10000n);
  assert.strictEqual(routes.length, 2);
  assert.strictEqual(routes[0].amountOut, 10010n, "best venue first");
});

test("findRouteArbitrage picks a cross-venue leg when the top venue matches", async () => {
  // Best buy and best sell are both CAMELOT, but CAMELOT->SUSHISWAP is a real
  // edge. The old guard returned null and threw it away.
  const oracle = stubOracle({
    "0xWETH>0xUSDC": { CAMELOT: 10050, SUSHISWAP: 9990 },
    "0xUSDC>0xWETH": { CAMELOT: 10090, SUSHISWAP: 10080 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opp = await finder.findRouteArbitrage("0xWETH", "0xUSDC", 10000n);
  assert.ok(opp, "a cross-venue edge must be reported");
  assert.strictEqual(opp.buyDex, "CAMELOT");
  assert.strictEqual(opp.sellDex, "SUSHISWAP");
  assert.ok(opp.netProfit > 0n, "net profit must be positive");
});

test("findRouteArbitrage returns null when only a same-venue pair exists", async () => {
  const oracle = stubOracle({
    "0xWETH>0xUSDC": { SUSHISWAP: 10000 },
    "0xUSDC>0xWETH": { SUSHISWAP: 10005 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opp = await finder.findRouteArbitrage("0xWETH", "0xUSDC", 10000n);
  assert.strictEqual(opp, null, "no cross-venue leg -> no opportunity");
});

test("findStablecoinArbitrage picks a cross-venue leg when the top venue matches", async () => {
  const oracle = stubOracle({
    "0xUSDC>0xUSDT": { SUSHISWAP: 10050, CAMELOT: 9990 },
    "0xUSDT>0xUSDC": { SUSHISWAP: 10090, CAMELOT: 10080 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opps = await finder.findStablecoinArbitrage(10000n);
  const o = opps.find((x) => x.pair === "USDC/USDT");
  assert.ok(o, "a cross-venue edge must be reported");
  assert.strictEqual(o.buyDex, "SUSHISWAP");
  assert.strictEqual(o.sellDex, "CAMELOT");
});

test("findStablecoinArbitrage skips a pair with no cross-venue leg", async () => {
  const oracle = stubOracle({
    "0xUSDC>0xUSDT": { SUSHISWAP: 10000 },
    "0xUSDT>0xUSDC": { SUSHISWAP: 10005 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opps = await finder.findStablecoinArbitrage(10000n);
  assert.strictEqual(
    opps.find((x) => x.pair === "USDC/USDT"),
    undefined,
  );
});

test("triangular cycle through one router but different pools is NOT discarded", async () => {
  // All three legs on SUSHISWAP but different pools (WETH/USDC, USDC/USDT,
  // USDT/WETH). The old venue-name guard returned null; the cycle is real.
  const oracle = stubOracle({
    "0xWETH>0xUSDC": { SUSHISWAP: 10050 },
    "0xUSDC>0xUSDT": { SUSHISWAP: 10050 },
    "0xUSDT>0xWETH": { SUSHISWAP: 10050 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const tri = await finder.calculateTriangularProfit(
    "0xWETH",
    "0xUSDC",
    "0xUSDT",
    10000n,
  );
  assert.ok(tri, "a mono-router cycle must not be discarded by venue name");
  assert.strictEqual(tri.dex1, "SUSHISWAP");
});
