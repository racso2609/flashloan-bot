// Tests for the centralised Aave V3 flashloan premium.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PREMIUM_BPS,
  PREMIUM_BPS,
  flashloanPremium,
  netOfPremium,
} = require("../src/flashloanPremium");

test("default premium is 5 bps (0.05%)", () => {
  assert.equal(DEFAULT_PREMIUM_BPS, 5n);
  // No env override in this process.
  assert.equal(PREMIUM_BPS, 5n);
});

test("premium is 0.05% of the borrowed amount", () => {
  // 10_000 USDC (6 decimals) -> 5 USDC premium
  assert.equal(flashloanPremium(10_000_000_000n), 5_000_000n);
  // 1 WETH (18 decimals) -> 0.0005 WETH
  assert.equal(flashloanPremium(1_000_000_000_000_000_000n), 500_000_000_000_000n);
});

test("premium truncates toward zero for tiny amounts", () => {
  // 999 wei * 5 / 10000 = 0 (integer division)
  assert.equal(flashloanPremium(999n), 0n);
  assert.equal(flashloanPremium(2000n), 1n);
});

test("premium of zero is zero", () => {
  assert.equal(flashloanPremium(0n), 0n);
});

test("netOfPremium subtracts the premium from gross profit", () => {
  const amount = 10_000_000_000n; // 10k USDC
  const profit = 6_000_000n; // 6 USDC gross
  assert.equal(netOfPremium(profit, amount), 1_000_000n); // 1 USDC net
});

test("netOfPremium goes negative when profit cannot cover the premium", () => {
  const amount = 10_000_000_000n;
  const profit = 1_000_000n; // 1 USDC gross < 5 USDC premium
  assert.ok(netOfPremium(profit, amount) < 0n);
});

test("AAVE_FLASHLOAN_PREMIUM_BPS overrides the default (fresh module)", () => {
  // The module reads the env at load time, so re-require with the var set.
  const path = require.resolve("../src/flashloanPremium");
  const prev = process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
  process.env.AAVE_FLASHLOAN_PREMIUM_BPS = "30"; // 0.30%
  delete require.cache[path];
  try {
    const fresh = require("../src/flashloanPremium");
    assert.equal(fresh.PREMIUM_BPS, 30n);
    assert.equal(fresh.flashloanPremium(10_000_000_000n), 30_000_000n);
  } finally {
    if (prev === undefined) delete process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
    else process.env.AAVE_FLASHLOAN_PREMIUM_BPS = prev;
    delete require.cache[path];
  }
});

test("an invalid override falls back to the default", () => {
  const path = require.resolve("../src/flashloanPremium");
  const prev = process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
  process.env.AAVE_FLASHLOAN_PREMIUM_BPS = "not-a-number";
  delete require.cache[path];
  try {
    const fresh = require("../src/flashloanPremium");
    assert.equal(fresh.PREMIUM_BPS, DEFAULT_PREMIUM_BPS);
  } finally {
    if (prev === undefined) delete process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
    else process.env.AAVE_FLASHLOAN_PREMIUM_BPS = prev;
    delete require.cache[path];
  }
});
