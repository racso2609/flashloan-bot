// Tests for route-structure validation.

const test = require("node:test");
const assert = require("node:assert");
const {
  bestRouteExcludingVenue,
  isSameVenueRoundTrip,
} = require("../src/routeValidation");

test("bestRouteExcludingVenue skips the excluded venue", () => {
  const routes = [
    { dex: "A", amountOut: 100n },
    { dex: "B", amountOut: 90n },
  ];
  assert.strictEqual(bestRouteExcludingVenue(routes, "A").dex, "B");
});

test("bestRouteExcludingVenue returns null when only the excluded venue exists", () => {
  assert.strictEqual(
    bestRouteExcludingVenue([{ dex: "A", amountOut: 100n }], "A"),
    null,
  );
});

test("bestRouteExcludingVenue ignores routes without a venue", () => {
  const routes = [{ amountOut: 100n }, { dex: "B", amountOut: 90n }];
  assert.strictEqual(bestRouteExcludingVenue(routes, "A").dex, "B");
});

test("bestRouteExcludingVenue handles empty / null input", () => {
  assert.strictEqual(bestRouteExcludingVenue([], "A"), null);
  assert.strictEqual(bestRouteExcludingVenue(null, "A"), null);
});

test("isSameVenueRoundTrip detects identical known venues", () => {
  assert.strictEqual(
    isSameVenueRoundTrip("UNISWAP_V3_500", "UNISWAP_V3_500"),
    true,
  );
  assert.strictEqual(
    isSameVenueRoundTrip("UNISWAP_V3_500", "SUSHISWAP"),
    false,
  );
});

test("isSameVenueRoundTrip treats unknown venues as NOT the same", () => {
  assert.strictEqual(isSameVenueRoundTrip(null, null), false);
  assert.strictEqual(isSameVenueRoundTrip(undefined, undefined), false);
  assert.strictEqual(isSameVenueRoundTrip(null, "SUSHISWAP"), false);
  assert.strictEqual(isSameVenueRoundTrip("SUSHISWAP", undefined), false);
});

test("isSameVenueRoundTrip compares by value, not by truthiness", () => {
  assert.strictEqual(isSameVenueRoundTrip("", ""), true);
  assert.strictEqual(isSameVenueRoundTrip(0, 0), true);
  assert.strictEqual(isSameVenueRoundTrip("", "SUSHISWAP"), false);
});
