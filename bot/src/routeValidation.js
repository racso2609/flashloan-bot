// Route-level validation helpers.
//
// NOTE on scope: pool "is this quote real?" validation lives in
// liquidityValidator.js, which reads the pool's own on-chain state (factory +
// liquidity/reserves). That is the authoritative filter. An earlier revision of
// this file tried to infer realness from the MAGNITUDE of the quote (drop
// routes far from the median); it was removed because it is unreliable — it
// keeps inflated phantoms and discards real venues when the majority of quotes
// for a pair are garbage. Do not reintroduce it.
//
// What remains here is purely about route STRUCTURE, independent of amounts.

/**
 * Best route from `routes` whose venue differs from `excludeVenue`.
 *
 * A round-trip that buys and sells on the same pool can only lose the fee twice,
 * so it is never an arbitrage. But that does NOT mean the opportunity is void:
 * the second-best venue on the sell side may still produce a cross-venue edge.
 * Picking the best *cross-venue* leg captures it, instead of aborting outright.
 *
 * @returns {object|null} the best compatible route, or null if none exists
 */
function bestRouteExcludingVenue(routes, excludeVenue) {
  if (!Array.isArray(routes) || routes.length === 0) return null;
  for (const r of routes) {
    if (!r) continue;
    // Routes without a venue cannot be proven cross-venue; skip them so the
    // guard stays sound (we never accept a leg we cannot distinguish).
    if (r.dex === undefined || r.dex === null) continue;
    if (String(r.dex) !== String(excludeVenue)) return r;
  }
  return null;
}

/**
 * True when a round-trip uses the same known venue on both legs.
 *
 * Only meaningful when both venues are known: two unknown venues are NOT the
 * same venue. Compares by value (not truthiness) so "" / 0 are handled
 * consistently.
 */
function isSameVenueRoundTrip(buyVenue, sellVenue) {
  if (buyVenue === undefined || buyVenue === null) return false;
  if (sellVenue === undefined || sellVenue === null) return false;
  return String(buyVenue) === String(sellVenue);
}

module.exports = { bestRouteExcludingVenue, isSameVenueRoundTrip };
