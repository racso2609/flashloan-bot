// Tests for route-structure validation.

const test = require("node:test");
const assert = require("node:assert");
const { bestRouteExcludingVenue } = require("../src/routeValidation");

test("bestRouteExcludingVenue picks the best leg regardless of array order", () => {
  // Unordered input: the maximum cross-venue leg must win, not the first one.
  const routes = [
    { dex: "B", amountOut: 90n },
    { dex: "A", amountOut: 100n },
    { dex: "C", amountOut: 120n },
  ];
  assert.strictEqual(bestRouteExcludingVenue(routes, "A").dex, "C");
});

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
