// Aave V3 flashloan premium.
//
// Aave V3 charges a fixed premium on `flashLoanSimple`. The pool computes it in
// FlashLoanLogic.sol as `amount.percentMulCeil(FLASHLOAN_PREMIUM_TOTAL)`, i.e.
// it ROUNDS UP (PercentageMath.percentMulCeil = floor(product/10000) plus 1 when
// there is any remainder). Our estimate must match that direction: if we rounded
// down we would under-count the repayment and could size a trade the contract
// rejects ("Not enough to repay loan") or, worse, treat a loss as a profit.
//
// FLASHLOAN_PREMIUM_TOTAL is 5 bps (0.05%) on Arbitrum and Base (verified
// on-chain). It used to be hardcoded as `(amount * 5n) / 10000n` (truncating) in
// ~7 places; centralised here and overridable via AAVE_FLASHLOAN_PREMIUM_BPS.

const PERCENTAGE_FACTOR = 10000n;
const DEFAULT_PREMIUM_BPS = 5n; // 0.05%

/**
 * Parse the env override. Accepts only a non-negative decimal integer (optional
 * leading '+'). Anything else - whitespace, hex, decimals, exponents, negatives
 * - falls back to the default rather than silently becoming 0 or a wrong value.
 */
function parsePremiumBps(raw) {
  if (raw === undefined || raw === null) return DEFAULT_PREMIUM_BPS;
  const trimmed = String(raw).trim();
  if (trimmed === "") return DEFAULT_PREMIUM_BPS;
  if (!/^\+?\d+$/.test(trimmed)) return DEFAULT_PREMIUM_BPS;
  try {
    const parsed = BigInt(trimmed);
    if (parsed < 0n) return DEFAULT_PREMIUM_BPS;
    return parsed;
  } catch {
    return DEFAULT_PREMIUM_BPS;
  }
}

// Read once at load time (PM2 fixes env at boot). Tests that need another value
// must clear require.cache for this module.
const PREMIUM_BPS = parsePremiumBps(process.env.AAVE_FLASHLOAN_PREMIUM_BPS);

/**
 * Premium Aave V3 will charge on a flashloan of `amount`, matching the pool's
 * percentMulCeil rounding (rounds UP).
 * @param {bigint} amount borrowed amount, in the asset's smallest unit
 * @returns {bigint} premium, same unit
 */
function flashloanPremium(amount) {
  const value = BigInt(amount);
  const product = value * PREMIUM_BPS;
  const floor = product / PERCENTAGE_FACTOR;
  const hasRemainder = product % PERCENTAGE_FACTOR !== 0n;
  return hasRemainder ? floor + 1n : floor;
}

/**
 * Net profit after the flashloan premium.
 * @param {bigint} profit gross profit (finalAmount - amountIn)
 * @param {bigint} amount borrowed amount
 * @returns {bigint} profit - premium
 */
function netOfPremium(profit, amount) {
  return BigInt(profit) - flashloanPremium(amount);
}

module.exports = {
  PERCENTAGE_FACTOR,
  DEFAULT_PREMIUM_BPS,
  PREMIUM_BPS,
  parsePremiumBps,
  flashloanPremium,
  netOfPremium,
};
