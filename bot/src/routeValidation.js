// Route validation helpers.
//
// Context: a V3 quoter does not always revert for a pool with no liquidity /
// no initialized ticks — some deployments return a value extrapolated from the
// current tick, or a near-zero amount for a thin/broken pool. Feeding those into
// the arbitrage math produces phantom spreads (e.g. ~100%, or billions of bps
// between a real pool and a broken one), which drowns the real signal.
//
// The defence is anchored on the BEST quote, not on the median: for any directed
// pair the deepest/most-liquid venue is the one that returns the most output,
// and broken pools return dramatically less (a thin pool gives 31 USDT for 10000
// USDC). So we keep quotes within a tolerance of the best and drop the rest.
//
// This is deliberately one-sided (only drops quotes far BELOW the best): a
// genuinely better venue is, by definition, the anchor and is never discarded.

const DEFAULT_MAX_DROP_BPS = 2000n; // 20% below the best quote

/**
 * Keep only quotes within `maxDropBps` of the best quote for the pair.
 *
 * @param {Array<{amountOut: bigint}>} quotes
 * @param {bigint} maxDropBps how far below the best a quote may fall
 * @returns {Array} the surviving quotes (same relative order as input)
 */
function filterOutlierQuotes(quotes, maxDropBps = DEFAULT_MAX_DROP_BPS) {
  const live = (quotes || []).filter((q) => q && q.amountOut > 0n);
  if (live.length < 2) return live; // nothing to compare against

  let best = 0n;
  for (const q of live) if (q.amountOut > best) best = q.amountOut;

  const floor = (best * (10000n - maxDropBps)) / 10000n;
  return live.filter((q) => q.amountOut >= floor);
}

/**
 * True when a round-trip uses the same venue on both legs. Such a trip can only
 * lose the pool fee, so it is never an arbitrage — used to avoid reporting the
 * "best buy == best sell" degenerate case as an opportunity.
 */
function isSameVenueRoundTrip(buyVenue, sellVenue) {
  if (!buyVenue || !sellVenue) return false;
  return String(buyVenue) === String(sellVenue);
}

module.exports = { filterOutlierQuotes, isSameVenueRoundTrip, DEFAULT_MAX_DROP_BPS };
