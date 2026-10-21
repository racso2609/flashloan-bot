// Authoritative pool-liquidity validation.
//
// A DEX quoter (V2 router or V3 quoter) will happily return a value for a pool
// that cannot actually absorb the trade — the number looks plausible but the
// swap would move the price enormously (or the pool is nearly empty). Inferring
// "is this quote real?" from the magnitude of the quote itself is unreliable
// (see routeValidation.js): the authoritative answer is the pool's own state.
//
// Two independent checks, both needed:
//   1. EXISTENCE + MINIMUM DEPTH: factory.getPool(a,b,fee) / getPair(a,b) then
//      pool.liquidity() / pair.getReserves(). No pool, or dust, means the quote
//      is not tradeable. This rejects empty pools outright.
//   2. PRICE IMPACT: a pool can hold liquidity yet be far too shallow for the
//      trade size (a 10000 USDC swap into a thin pool returns 398 DAI). We
//      compare the quoter's effective price against the pool's spot price and
//      reject quotes whose impact exceeds a threshold.
//
// Results are cached with a TTL because liquidity moves slowly relative to the
// bot's block cadence, and the extra RPC calls are not free.

const { ethers } = require("ethers");
const config = require("../config/config");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Minimum in-range liquidity (V3) / reserve (V2) for a pool to be considered
// tradeable at all. This only rejects dust; depth-for-size is handled by the
// price-impact check below.
const DEFAULT_MIN_V3_LIQUIDITY = 10n ** 15n;
const DEFAULT_MIN_V2_RESERVE = 10n ** 15n;

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
    if (amountIn === 0n || spotPrice <= 0) return null;
    const inHuman = Number(amountIn) / 10 ** decIn;
    const outHuman = Number(amountOut) / 10 ** decOut;
    if (inHuman <= 0) return null;
    const effectivePrice = outHuman / inHuman;
    const impact = (spotPrice - effectivePrice) / spotPrice;
    return Math.abs(impact) * 10000;
  }

  /**
   * True when the V3 pool for (tokenIn, tokenOut, fee) exists, holds enough
   * in-range liquidity, and would not be moved excessively by `amountIn`.
   * Fail-closed: any probe failure or uncomputable impact => not tradeable.
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

    // Depth-for-size check only when the caller can supply the numbers.
    if (
      amountOut !== undefined &&
      amountIn !== undefined &&
      poolInfo.spotPrice
    ) {
      const impact = LiquidityValidator.priceImpactBps(
        amountIn,
        amountOut,
        decIn,
        decOut,
        poolInfo.spotPrice,
      );
      if (impact === null || impact > this.maxPriceImpactBps) return false;
    }
    return true;
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

      // Spot price from slot0: sqrtPriceX96^2 = price(token1/token0), in raw
      // units. Convert to human tokenOut-per-tokenIn so the impact check can
      // compare it against the quoter's effective (human) price.
      let spotPrice = null;
      try {
        const slot0 = await c.slot0();
        const sqrtP = Number(slot0[0]) / 2 ** 96;
        const raw = sqrtP * sqrtP; // token1 per token0, raw units
        const token0 = await c.token0();
        const dec0 = await this._decimals(token0);
        const token1 = await c.token1();
        const dec1 = await this._decimals(token1);
        const inIsToken0 =
          normalizeAddress(tokenIn) === normalizeAddress(token0);
        if (inIsToken0) {
          // tokenOut = token1: human = raw * 10^(dec0 - dec1)
          spotPrice = raw * 10 ** (dec0 - dec1);
        } else {
          // tokenOut = token0: human = (1/raw) * 10^(dec1 - dec0)
          spotPrice = (1 / raw) * 10 ** (dec1 - dec0);
        }
      } catch {
        spotPrice = null;
      }
      return { ok: true, spotPrice };
    } catch {
      return { ok: false };
    }
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

  /**
   * True when the V2 pair for (tokenIn, tokenOut) exists on `dexName` and holds
   * enough reserves. Fail-closed.
   */
  async hasV2Liquidity(dexName, tokenIn, tokenOut) {
    const factory = this.v2Factories[dexName];
    if (!factory) return true; // no factory configured -> cannot validate
    const key = `v2:${dexName}:${normalizeAddress(tokenIn)}:${normalizeAddress(tokenOut)}`;
    const cached = this._getCached(key);
    if (cached !== undefined) return cached;

    let result = false;
    try {
      const pair = await factory.getPair(
        normalizeAddress(tokenIn),
        normalizeAddress(tokenOut),
      );
      if (pair && pair !== ZERO_ADDRESS) {
        const c = this._contractFactory(pair, config.UNISWAP_V2_PAIR_ABI);
        const [r0, r1] = await c.getReserves();
        result = r0 >= this.minV2Reserve && r1 >= this.minV2Reserve;
      }
    } catch {
      result = false;
    }
    this._setCached(key, result);
    return result;
  }
}

module.exports = {
  LiquidityValidator,
  DEFAULT_MIN_V3_LIQUIDITY,
  DEFAULT_MIN_V2_RESERVE,
  DEFAULT_MAX_PRICE_IMPACT_BPS,
  ZERO_ADDRESS,
};
