// Authoritative pool-liquidity validation.
//
// A DEX quoter (V2 router or V3 quoter) will happily return a value for a pool
// that cannot actually absorb the trade — the number looks plausible but the
// swap would move the price enormously (or the pool is nearly empty).
//
// Inferring "is this quote real?" from the MAGNITUDE of the quote itself is
// unreliable (see routeValidation.js): the authoritative answer is the pool's
// own on-chain state.
//
// Two independent checks:
//   1. EXISTENCE + NOT-DUST: factory.getPool(a,b,fee) / getPair(a,b), then the
//      pool's liquidity() / getReserves(). This only rejects empty or dust
//      pools — it is NOT a depth filter.
//   2. PRICE IMPACT: the real depth filter. A pool can hold liquidity yet be
//      far too shallow for the trade size (10000 USDC into a thin pool returns
//      398 DAI, a ~96% impact). We compare the quoter's effective price against
//      the pool's spot price and reject quotes that move the pool too much.
//
// IMPORTANT: the impact check is FAIL-CLOSED. If the caller supplies a quote
// (amountIn/amountOut) but the spot price cannot be computed (slot0 reverts,
// decimals missing, sqrtPriceX96 == 0), the quote is REJECTED. Skipping the
// check would let an unverifiable phantom through.
//
// Results are cached with a TTL because liquidity moves slowly relative to the
// bot's block cadence, and the extra RPC calls are not free.

const { ethers } = require("ethers");
const config = require("../config/config");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Dust floor, in RAW units. This is deliberately tiny: it exists only to reject
// pools that are effectively empty. It is NOT a depth threshold — a raw floor
// cannot be compared across tokens with different decimals (1e15 raw is $1B for
// a 6-dec stablecoin but 0.001 for an 18-dec token), so depth-for-size is
// handled entirely by the price-impact check below.
const DEFAULT_MIN_V3_LIQUIDITY = 10n ** 6n;
const DEFAULT_MIN_V2_RESERVE = 10n ** 6n;

// Maximum acceptable price impact (in bps) between the quoter's effective price
// and the pool's spot price. A trade that moves the pool more than this is not
// executable at the quoted price.
const DEFAULT_MAX_PRICE_IMPACT_BPS = 200n; // 2%

const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_MAX = 500;

function normalizeAddress(address) {
  try {
    return ethers.getAddress(address);
  } catch {
    return String(address).toLowerCase();
  }
}

class LiquidityValidator {
  constructor(provider, chainConfig, options = {}) {
    this.provider = provider;
    const cfg = chainConfig || config;

    this.minV3Liquidity = options.minV3Liquidity ?? DEFAULT_MIN_V3_LIQUIDITY;
    this.minV2Reserve = options.minV2Reserve ?? DEFAULT_MIN_V2_RESERVE;
    this.maxPriceImpactBps =
      options.maxPriceImpactBps ?? DEFAULT_MAX_PRICE_IMPACT_BPS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cacheMax = options.cacheMax ?? DEFAULT_CACHE_MAX;
    this._cache = new Map();

    // Injectable so tests can stub the contract layer without an RPC.
    this._contractFactory =
      options.contractFactory ||
      ((address, abi) => new ethers.Contract(address, abi, provider));

    const factories = cfg.DEX_FACTORIES || {};
    this.v3Factory = factories.UNISWAP_V3
      ? this._contractFactory(
          normalizeAddress(factories.UNISWAP_V3),
          config.UNISWAP_V3_FACTORY_ABI,
        )
      : null;
    this.v2Factories = {};
    if (factories.SUSHISWAP) {
      this.v2Factories.SUSHISWAP = this._contractFactory(
        normalizeAddress(factories.SUSHISWAP),
        config.UNISWAP_V2_FACTORY_ABI,
      );
    }
    if (factories.CAMELOT) {
      this.v2Factories.CAMELOT = this._contractFactory(
        normalizeAddress(factories.CAMELOT),
        config.UNISWAP_V2_FACTORY_ABI,
      );
    }
  }

  _getCached(key) {
    const hit = this._cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.cacheTtlMs) {
      this._cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  _setCached(key, value) {
    if (this._cache.size >= this.cacheMax) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, { at: Date.now(), value });
  }

  /**
   * Effective price impact (bps) of selling `amountIn` of tokenIn into the pool,
   * given the pool's spot price. Returns null when it cannot be computed.
   *
   * @param {bigint} amountIn
   * @param {bigint} amountOut from the quoter
   * @param {number} decIn decimals of tokenIn
   * @param {number} decOut decimals of tokenOut
   * @param {number} spotPrice human tokenOut per tokenIn at the pool's spot
   */
  static priceImpactBps(amountIn, amountOut, decIn, decOut, spotPrice) {
    if (amountIn === 0n || amountOut === 0n) return null;
    if (!Number.isFinite(spotPrice) || spotPrice <= 0) return null;
    const inHuman = Number(amountIn) / 10 ** decIn;
    const outHuman = Number(amountOut) / 10 ** decOut;
    // Guard against Number() overflow: a huge BigInt becomes Infinity, which
    // would make the ratio NaN and slip past the impact check. Fail-closed.
    if (!Number.isFinite(inHuman) || !Number.isFinite(outHuman)) return null;
    if (inHuman <= 0) return null;
    const effectivePrice = outHuman / inHuman;
    if (!Number.isFinite(effectivePrice)) return null;
    const impact = (spotPrice - effectivePrice) / spotPrice;
    if (!Number.isFinite(impact)) return null;
    return Math.abs(impact) * 10000;
  }

  /**
   * Shared impact gate. `poolInfo.spotPrice` may be null when the pool state
   * could not be read; in that case an unverifiable quote is REJECTED (fail
   * closed) as long as the caller actually supplied a quote to check.
   *
   * @returns {boolean} true when the trade may proceed
   */
  _passesImpact(poolInfo, amountIn, amountOut, decIn, decOut) {
    const hasQuote = amountIn !== undefined && amountOut !== undefined;
    if (!hasQuote) return true; // existence-only probe, nothing to verify
    if (!poolInfo.spotPrice || !Number.isFinite(poolInfo.spotPrice))
      return false;
    const impact = LiquidityValidator.priceImpactBps(
      amountIn,
      amountOut,
      decIn,
      decOut,
      poolInfo.spotPrice,
    );
    if (impact === null) return false;
    return impact <= this.maxPriceImpactBps;
  }

  /**
   * True when the V3 pool for (tokenIn, tokenOut, fee) exists, is not dust, and
   * would not be moved excessively by the trade. Fail-closed.
   */
  async isV3Tradeable(
    tokenIn,
    tokenOut,
    fee,
    amountIn,
    amountOut,
    decIn,
    decOut,
  ) {
    if (!this.v3Factory) return true; // no factory configured -> cannot validate
    const key = `v3:${normalizeAddress(tokenIn)}:${normalizeAddress(tokenOut)}:${fee}`;

    let poolInfo = this._getCached(key);
    if (poolInfo === undefined) {
      poolInfo = await this._probeV3(tokenIn, tokenOut, fee);
      this._setCached(key, poolInfo);
    }
    if (!poolInfo || !poolInfo.ok) return false;
    return this._passesImpact(poolInfo, amountIn, amountOut, decIn, decOut);
  }

  async _probeV3(tokenIn, tokenOut, fee) {
    try {
      const pool = await this.v3Factory.getPool(
        normalizeAddress(tokenIn),
        normalizeAddress(tokenOut),
        fee,
      );
      if (!pool || pool === ZERO_ADDRESS) return { ok: false };
      const c = this._contractFactory(pool, config.UNISWAP_V3_POOL_ABI);
      const liquidity = await c.liquidity();
      if (liquidity < this.minV3Liquidity) return { ok: false };
      return { ok: true, spotPrice: await this._v3SpotPrice(c, tokenIn) };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Human spot price (tokenOut per tokenIn) from a V3 pool's slot0.
   * Returns null when it cannot be derived; callers treat null as fail-closed.
   */
  async _v3SpotPrice(poolContract, tokenIn) {
    try {
      const slot0 = await poolContract.slot0();
      const sqrtP = Number(slot0[0]) / 2 ** 96; // sqrt(price) in raw units
      if (!Number.isFinite(sqrtP) || sqrtP <= 0) return null;
      const raw = sqrtP * sqrtP; // token1 per token0, raw
      if (!Number.isFinite(raw) || raw <= 0) return null;
      const token0 = await poolContract.token0();
      const token1 = await poolContract.token1();
      const dec0 = await this._decimals(token0);
      const dec1 = await this._decimals(token1);
      const inIsToken0 = normalizeAddress(tokenIn) === normalizeAddress(token0);
      // human(token1/token0) = raw * 10^(dec0-dec1)
      const spot = inIsToken0
        ? raw * 10 ** (dec0 - dec1)
        : (1 / raw) * 10 ** (dec1 - dec0);
      return Number.isFinite(spot) && spot > 0 ? spot : null;
    } catch {
      return null;
    }
  }

  /**
   * True when the V2 pair for (tokenIn, tokenOut) exists on `dexName`, is not
   * dust, and would not be moved excessively by the trade. Fail-closed.
   */
  async isV2Tradeable(
    dexName,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    decIn,
    decOut,
  ) {
    const factory = this.v2Factories[dexName];
    if (!factory) return true; // no factory configured -> cannot validate
    const key = `v2:${dexName}:${normalizeAddress(tokenIn)}:${normalizeAddress(tokenOut)}`;

    let pairInfo = this._getCached(key);
    if (pairInfo === undefined) {
      pairInfo = await this._probeV2(factory, tokenIn, tokenOut);
      this._setCached(key, pairInfo);
    }
    if (!pairInfo || !pairInfo.ok) return false;
    return this._passesImpact(pairInfo, amountIn, amountOut, decIn, decOut);
  }

  async _probeV2(factory, tokenIn, tokenOut) {
    try {
      const pair = await factory.getPair(
        normalizeAddress(tokenIn),
        normalizeAddress(tokenOut),
      );
      if (!pair || pair === ZERO_ADDRESS) return { ok: false };
      const c = this._contractFactory(pair, config.UNISWAP_V2_PAIR_ABI);
      const [r0, r1] = await c.getReserves();
      if (r0 < this.minV2Reserve || r1 < this.minV2Reserve)
        return { ok: false };

      let spotPrice = null;
      try {
        const token0 = await c.token0();
        const token1 = await c.token1();
        const inIsToken0 =
          normalizeAddress(tokenIn) === normalizeAddress(token0);
        const outIsToken1 =
          normalizeAddress(tokenOut) === normalizeAddress(token1);
        const inIsToken1 =
          normalizeAddress(tokenIn) === normalizeAddress(token1);
        const outIsToken0 =
          normalizeAddress(tokenOut) === normalizeAddress(token0);
        // The pair must actually trade this directed pair. If tokenIn/tokenOut
        // are not the pair's own tokens, we cannot derive a meaningful spot and
        // must not claim the trade is safe (fail-closed).
        if ((inIsToken0 && outIsToken1) || (inIsToken1 && outIsToken0)) {
          const dec0 = await this._decimals(token0);
          const dec1 = await this._decimals(token1);
          const h0 = Number(r0) / 10 ** dec0;
          const h1 = Number(r1) / 10 ** dec1;
          if (h0 > 0 && h1 > 0) spotPrice = inIsToken0 ? h1 / h0 : h0 / h1;
        }
      } catch {
        spotPrice = null;
      }
      return { ok: true, spotPrice };
    } catch {
      return { ok: false };
    }
  }

  /**
   * Backwards-compatible existence check (no impact). Prefer isV2Tradeable when
   * the quote is available.
   */
  async hasV2Liquidity(dexName, tokenIn, tokenOut) {
    const factory = this.v2Factories[dexName];
    if (!factory) return true;
    const key = `v2:${dexName}:${normalizeAddress(tokenIn)}:${normalizeAddress(tokenOut)}`;
    let pairInfo = this._getCached(key);
    if (pairInfo === undefined) {
      pairInfo = await this._probeV2(factory, tokenIn, tokenOut);
      this._setCached(key, pairInfo);
    }
    return Boolean(pairInfo && pairInfo.ok);
  }

  async _decimals(tokenAddress) {
    const key = `dec:${normalizeAddress(tokenAddress)}`;
    const cached = this._getCached(key);
    if (cached !== undefined) return cached;
    let d = 18;
    try {
      const c = this._contractFactory(tokenAddress, config.ERC20_ABI);
      d = Number(await c.decimals());
    } catch {
      d = 18;
    }
    this._setCached(key, d);
    return d;
  }
}

module.exports = {
  LiquidityValidator,
  DEFAULT_MIN_V3_LIQUIDITY,
  DEFAULT_MIN_V2_RESERVE,
  DEFAULT_MAX_PRICE_IMPACT_BPS,
  ZERO_ADDRESS,
};
