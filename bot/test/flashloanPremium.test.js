// Tests for the centralised Aave V3 flashloan premium.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  PERCENTAGE_FACTOR,
  DEFAULT_PREMIUM_BPS,
  PREMIUM_BPS,
  parsePremiumBps,
  flashloanPremium,
  netOfPremium,
} = require("../src/flashloanPremium");

// Reference implementation of Aave's PercentageMath.percentMulCeil, copied from
// lib/aave-v3-origin/.../PercentageMath.sol: floor(product/10000) plus 1 when
// there is any remainder. Used to pin the rounding direction.
function aavePercentMulCeil(value, percentage) {
  const product = value * percentage;
  const floor = product / PERCENTAGE_FACTOR;
  return product % PERCENTAGE_FACTOR === 0n ? floor : floor + 1n;
}

test("default premium is 5 bps (0.05%)", () => {
  assert.equal(DEFAULT_PREMIUM_BPS, 5n);
  assert.equal(PREMIUM_BPS, 5n); // no env override in this process
});

test("premium matches Aave's percentMulCeil for a range of amounts", () => {
  for (const amount of [
    0n,
    1n,
    999n,
    2000n,
    10_000n,
    10_000_000_000n,
    1_000_000_000_000_000_000n,
    123_456_789_012_345n,
  ]) {
    assert.equal(
      flashloanPremium(amount),
      aavePercentMulCeil(amount, PREMIUM_BPS),
      `mismatch for amount=${amount}`,
    );
  }
});

test("premium ROUNDS UP (ceil), not down", () => {
  // 2000 * 5 / 10000 = 1 exactly -> 1
  assert.equal(flashloanPremium(2000n), 1n);
  // 1 * 5 / 10000 = 0.0005 -> ceil = 1 (a truncating impl would return 0)
  assert.equal(flashloanPremium(1n), 1n);
  // 999 * 5 / 10000 = 0.4995 -> ceil = 1
  assert.equal(flashloanPremium(999n), 1n);
  // 2001 * 5 / 10000 = 1.0005 -> ceil = 2
  assert.equal(flashloanPremium(2001n), 2n);
});

test("premium of zero is zero", () => {
  assert.equal(flashloanPremium(0n), 0n);
});

test("netOfPremium subtracts the (ceiled) premium from gross profit", () => {
  const amount = 10_000_000_000n; // 10k USDC -> 5 USDC premium
  const profit = 6_000_000n; // 6 USDC gross
  assert.equal(netOfPremium(profit, amount), 1_000_000n); // 1 USDC net
});

test("netOfPremium goes negative when profit cannot cover the premium", () => {
  const amount = 10_000_000_000n;
  const profit = 1_000_000n; // 1 USDC gross < 5 USDC premium
  assert.ok(netOfPremium(profit, amount) < 0n);
});

test("parsePremiumBps accepts a plain non-negative integer", () => {
  assert.equal(parsePremiumBps("30"), 30n);
  assert.equal(parsePremiumBps("+7"), 7n);
  assert.equal(parsePremiumBps(" 30 "), 30n);
  assert.equal(parsePremiumBps("0"), 0n);
});

test("parsePremiumBps rejects malformed values instead of silently zeroing", () => {
  for (const bad of ["", "   ", "5.5", "0x5", "1e3", "-1", "abc", "5bps"]) {
    assert.equal(
      parsePremiumBps(bad),
      DEFAULT_PREMIUM_BPS,
      `expected fallback for ${JSON.stringify(bad)}`,
    );
  }
});

test("AAVE_FLASHLOAN_PREMIUM_BPS overrides the default (fresh module)", () => {
  const path = require.resolve("../src/flashloanPremium");
  const prev = process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
  process.env.AAVE_FLASHLOAN_PREMIUM_BPS = "30"; // 0.30%
  delete require.cache[path];
  try {
    const fresh = require("../src/flashloanPremium");
    assert.equal(fresh.PREMIUM_BPS, 30n);
    // 10_000 USDC * 30 bps = 30 USDC, and it must still be ceiled.
    assert.equal(fresh.flashloanPremium(10_000_000_000n), 30_000_000n);
    assert.equal(fresh.flashloanPremium(1n), 1n); // ceil, not 0
  } finally {
    if (prev === undefined) delete process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
    else process.env.AAVE_FLASHLOAN_PREMIUM_BPS = prev;
    delete require.cache[path];
  }
});

test("a malformed override falls back to the default (fresh module)", () => {
  const path = require.resolve("../src/flashloanPremium");
  const prev = process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
  process.env.AAVE_FLASHLOAN_PREMIUM_BPS = "   ";
  delete require.cache[path];
  try {
    const fresh = require("../src/flashloanPremium");
    // "   " must NOT become 0 (the pre-fix bug); it must fall back to 5 bps.
    assert.equal(fresh.PREMIUM_BPS, DEFAULT_PREMIUM_BPS);
    assert.equal(fresh.flashloanPremium(10_000_000_000n), 5_000_000n);
  } finally {
    if (prev === undefined) delete process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
    else process.env.AAVE_FLASHLOAN_PREMIUM_BPS = prev;
    delete require.cache[path];
  }
});
