// Aave V3 flashloan premium.
//
// Aave V3 charges a fixed 0.05% (5 bps) premium on `flashLoanSimple`, and the
// contract repays `amount + premium` where `premium` is what the pool passes to
// `executeOperation` (see contracts/src/Flashloan.sol). That value is set by the
// pool, not by us, so it must stay in sync with the deployed Aave pool config.
//
// It used to be hardcoded as `(amount * 5n) / 10000n` in ~7 places, which means a
// pool fee change would silently make every netProfit estimate wrong (and could
// let the bot execute at a loss). Centralised here and overridable via
// AAVE_FLASHLOAN_PREMIUM_BPS for future pools/forks.

const DEFAULT_PREMIUM_BPS = 5n; // 0.05%

function resolvePremiumBps() {
  const raw = process.env.AAVE_FLASHLOAN_PREMIUM_BPS;
  if (raw === undefined || raw === "") return DEFAULT_PREMIUM_BPS;
  let parsed;
  try {
    parsed = BigInt(raw);
  } catch {
    return DEFAULT_PREMIUM_BPS;
  }
  if (parsed < 0n) return DEFAULT_PREMIUM_BPS;
  return parsed;
}

const PREMIUM_BPS = resolvePremiumBps();

/**
 * Premium Aave V3 will charge on a flashloan of `amount`.
 * @param {bigint} amount borrowed amount, in the asset's smallest unit
 * @returns {bigint} premium, same unit
 */
function flashloanPremium(amount) {
  return (BigInt(amount) * PREMIUM_BPS) / 10000n;
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
  DEFAULT_PREMIUM_BPS,
  PREMIUM_BPS,
  flashloanPremium,
  netOfPremium,
};
