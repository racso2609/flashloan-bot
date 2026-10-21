// Integration tests: the validation actually changes smartFinder's output.
//
// We stub the price oracle so no RPC is needed, and assert the two behaviours
// that matter:
//   1. A phantom route no longer inflates the reported spread.
//   2. A same-venue round-trip is not reported as an opportunity.

const test = require("node:test");
const assert = require("node:assert");
const SmartArbitrageFinder = require("../src/smartFinder");

// Minimal oracle stub: returns a fixed set of routes per directed pair.
// `routers` must list the venue names so findBestRoute iterates them.
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

test("a broken low quote no longer inflates the spread", async () => {
  // USDC->USDT: two real venues agree (~10000), one broken pool reports 31.
  const oracle = stubOracle({
    "0xUSDC>0xUSDT": { SUSHISWAP: 9990, CAMELOT: 10010, BROKEN: 31 },
    "0xUSDT>0xUSDC": { SUSHISWAP: 9990, CAMELOT: 10010 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const routes = await finder.findBestRoute("0xUSDC", "0xUSDT", 10000n);
  const venues = routes.map((r) => r.dex);
  assert.ok(!venues.includes("BROKEN"), "broken venue must be filtered out");
  assert.strictEqual(routes[0].amountOut, 10010n, "best real venue is chosen");
  // The spread between the surviving routes is small, not ~100%.
  const spread = Number(routes[0].amountOut - routes[routes.length - 1].amountOut);
  assert.ok(spread < 100, `spread must be realistic, got ${spread}`);
});

test("same-venue round-trip is not reported as stablecoin arbitrage", async () => {
  // Both directions are best on SUSHISWAP -> degenerate round-trip.
  const oracle = stubOracle({
    "0xUSDC>0xUSDT": { SUSHISWAP: 10000, CAMELOT: 9990 },
    "0xUSDT>0xUSDC": { SUSHISWAP: 10005, CAMELOT: 9990 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opps = await finder.findStablecoinArbitrage(10000n);
  const usdcUsdt = opps.find((o) => o.pair === "USDC/USDT");
  assert.strictEqual(usdcUsdt, undefined, "same-venue trip must be skipped");
});

test("findRouteArbitrage skips a same-venue round-trip", async () => {
  // Best buy and best sell both on SUSHISWAP -> degenerate, must return null.
  const oracle = stubOracle({
    "0xWETH>0xUSDC": { SUSHISWAP: 10000, CAMELOT: 9990 },
    "0xUSDC>0xWETH": { SUSHISWAP: 10005, CAMELOT: 9990 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opp = await finder.findRouteArbitrage("0xWETH", "0xUSDC", 10000n);
  assert.strictEqual(opp, null, "same-venue trip must not be reported");
});

test("findRouteArbitrage reports a cross-venue edge", async () => {
  const oracle = stubOracle({
    "0xWETH>0xUSDC": { SUSHISWAP: 9990, CAMELOT: 10050 },
    "0xUSDC>0xWETH": { SUSHISWAP: 10020, CAMELOT: 9990 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opp = await finder.findRouteArbitrage("0xWETH", "0xUSDC", 10000n);
  assert.ok(opp, "a cross-venue edge must be reported");
  assert.strictEqual(opp.buyDex, "CAMELOT");
  assert.strictEqual(opp.sellDex, "SUSHISWAP");
});

test("cross-venue round-trip with a real edge IS reported", async () => {
  // Buy on CAMELOT (more out), sell on SUSHISWAP (more back) -> real edge.
  const oracle = stubOracle({
    "0xUSDC>0xUSDT": { SUSHISWAP: 9990, CAMELOT: 10050 },
    "0xUSDT>0xUSDC": { SUSHISWAP: 10020, CAMELOT: 9990 },
  });
  const finder = new SmartArbitrageFinder(null, oracle, chainConfig);

  const opps = await finder.findStablecoinArbitrage(10000n);
  const usdcUsdt = opps.find((o) => o.pair === "USDC/USDT");
  assert.ok(usdcUsdt, "a cross-venue edge must be reported");
  assert.strictEqual(usdcUsdt.buyDex, "CAMELOT");
  assert.strictEqual(usdcUsdt.sellDex, "SUSHISWAP");
  assert.ok(usdcUsdt.netProfit > 0n, "net profit must be positive");
});
