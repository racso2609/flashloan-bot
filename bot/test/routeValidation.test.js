// Tests for route validation (P0).
//
// Run: node --test bot/test/   (or npm test from bot/)
//
// These cover the pure logic in routeValidation.js. The integration effect on
// smartFinder is covered by test/smartFinder.validation.test.js, which stubs
// the price oracle so no RPC is needed.

const test = require("node:test");
const assert = require("node:assert");
const {
  filterOutlierQuotes,
  isSameVenueRoundTrip,
  DEFAULT_MAX_DROP_BPS,
} = require("../src/routeValidation");

const q = (amountOut, venue = "X") => ({ venue, amountOut: BigInt(amountOut) });
const values = (arr) => arr.map((x) => Number(x.amountOut));

test("keeps all quotes when there is only one", () => {
  const out = filterOutlierQuotes([q(100)]);
  assert.strictEqual(out.length, 1);
});

test("drops quotes far BELOW the best (thin/broken pools)", () => {
  // Realistic stablecoin case: two good venues near 10000, two broken ones.
  const out = filterOutlierQuotes([q(31), q(40), q(10008), q(9999)]);
  assert.deepStrictEqual(values(out).sort((a, b) => a - b), [9999, 10008]);
});

test("keeps a genuinely better venue (it becomes the anchor)", () => {
  // 12% better than the rest is a real edge, not an outlier.
  const out = filterOutlierQuotes([q(9900), q(10000), q(10100), q(11200)]);
  assert.strictEqual(out.length, 4);
});

test("drops a quote that is more than 20% below the best", () => {
  const out = filterOutlierQuotes([q(7900), q(10000), q(10100)]);
  assert.deepStrictEqual(values(out).sort((a, b) => a - b), [10000, 10100]);
});

test("keeps a quote exactly at the 20% floor", () => {
  const out = filterOutlierQuotes([q(8000), q(10000)]);
  assert.strictEqual(out.length, 2);
});

test("respects a custom drop threshold", () => {
  // With 5% tolerance, a quote 12% below the best is dropped.
  const out = filterOutlierQuotes([q(8800), q(10000)], 500n);
  assert.deepStrictEqual(values(out), [10000]);
});

test("ignores zero/empty quotes", () => {
  const out = filterOutlierQuotes([q(0), q(9990), q(10000), q(10010)]);
  assert.strictEqual(out.length, 3);
  assert.ok(out.every((x) => x.amountOut > 0n));
});

test("returns an empty array for empty / null input", () => {
  assert.deepStrictEqual(filterOutlierQuotes([]), []);
  assert.deepStrictEqual(filterOutlierQuotes(null), []);
});

test("default drop is 20%", () => {
  assert.strictEqual(DEFAULT_MAX_DROP_BPS, 2000n);
});

test("isSameVenueRoundTrip detects identical venues", () => {
  assert.strictEqual(isSameVenueRoundTrip("UNISWAP_V3_500", "UNISWAP_V3_500"), true);
  assert.strictEqual(isSameVenueRoundTrip("UNISWAP_V3_500", "SUSHISWAP"), false);
  assert.strictEqual(isSameVenueRoundTrip(null, "SUSHISWAP"), false);
  assert.strictEqual(isSameVenueRoundTrip(undefined, undefined), false);
});
