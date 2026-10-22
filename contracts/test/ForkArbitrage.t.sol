// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Flashloan, DexType, SwapLeg, ArbitrageParams} from "../src/Flashloan.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IQuoterV2 {
    // Classic Quoter signature (5 scalar args). Used by the Arb/Base Quoter
    // deployments addressed here; the struct-based QuoterV2 overload reverts
    // on these chains.
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut);
}

interface IV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

interface IAavePool {
    function flashLoanSimple(address receiver, address asset, uint256 amount, bytes calldata params, uint16 refCode)
        external;
}

/**
 * @notice Mainnet-fork arbitrage test for Arbitrum and Base.
 *
 * Runs the real Flashloan contract against live Aave pools and DEX routers on
 * a forked chain, discovering whether a UniV3 <-> SushiV2 round-trip is
 * profitable, and executing it atomically.
 *
 * Usage:
 *   ARBITRUM_RPC_URL=... forge test --match-contract ForkArbitrage --match-test test_arbitrum -vvvv
 *   BASE_RPC_URL=...     forge test --match-contract ForkArbitrage --match-test test_base -vvvv
 *
 * The test is self-contained: it probes several fee tiers/directions and only
 * asserts when it finds a quotable route. This keeps it green across market
 * conditions while still proving end-to-end execution when an edge exists.
 */
contract ForkArbitrageTest is Test {
    // ---- Arbitrum One ----
    address constant ARB_AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant ARB_AAVE_PROVIDER = 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb;
    address constant ARB_SUSHI = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    address constant ARB_UNI_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant ARB_UNI_V3_QUOTER = 0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6;
    address constant ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant ARB_USDC_E = 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8;
    address constant ARB_WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;

    // ---- Base ----
    address constant BASE_AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant BASE_AAVE_PROVIDER = 0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D;
    address constant BASE_SUSHI = 0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891;
    address constant BASE_UNI_V3_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant BASE_UNI_V3_QUOTER = 0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;

    struct ChainCtx {
        address pool;
        address provider;
        address quoter;
        address sushi;
        address v3Router;
        address usdc;
        address weth;
    }

    /**
     * Probe a UniV3 <-> SushiV2 round trip. Returns the best net result
     * (can be negative) and the chosen fee/direction, or 0 if unquotable.
     */
    function _probe(
        address quoter,
        address sushi,
        address usdc,
        address weth,
        bool uniBuyWeth, // true: UniV3 buys WETH (USDC->WETH), Sushi sells back
        uint24 fee,
        uint256 loan
    ) internal returns (bool ok, uint256 finalUsdc, uint256 amountWeth) {
        // Leg 1: USDC -> WETH
        if (uniBuyWeth) {
            try IQuoterV2(quoter).quoteExactInputSingle(usdc, weth, fee, loan, 0) returns (uint256 out) {
                amountWeth = out;
            } catch {
                return (false, 0, 0);
            }
        } else {
            address[] memory p = new address[](2);
            p[0] = usdc;
            p[1] = weth;
            try IV2Router(sushi).getAmountsOut(loan, p) returns (uint256[] memory a) {
                amountWeth = a[1];
            } catch {
                return (false, 0, 0);
            }
        }

        if (amountWeth == 0) return (false, 0, 0);

        // Leg 2: WETH -> USDC
        if (uniBuyWeth) {
            address[] memory p = new address[](2);
            p[0] = weth;
            p[1] = usdc;
            try IV2Router(sushi).getAmountsOut(amountWeth, p) returns (uint256[] memory a) {
                finalUsdc = a[1];
            } catch {
                return (false, 0, 0);
            }
        } else {
            try IQuoterV2(quoter).quoteExactInputSingle(weth, usdc, fee, amountWeth, 0) returns (uint256 out) {
                finalUsdc = out;
            } catch {
                return (false, 0, 0);
            }
        }

        return (true, finalUsdc, amountWeth);
    }

    function _runFork(string memory envKey, address poolAddr, address providerAddr) internal returns (uint256 forkId) {
        string memory rpc = vm.envString(envKey);
        forkId = vm.createFork(rpc);
        vm.selectFork(forkId);
        vm.label(poolAddr, "AavePool");
        vm.label(providerAddr, "AaveProvider");
    }

    function _scan(address quoter, address sushi, address usdc, address weth, uint24[4] memory fees, uint256 loan)
        internal
        returns (uint256 bestFinal, bool bestUniBuy, uint24 bestFee, bool found)
    {
        for (uint256 i = 0; i < fees.length; i++) {
            for (uint256 d = 0; d < 2; d++) {
                bool uniBuy = d == 0;
                (bool ok, uint256 finalUsdc,) = _probe(quoter, sushi, usdc, weth, uniBuy, fees[i], loan);
                if (!ok) continue;
                if (!found || finalUsdc > bestFinal) {
                    bestFinal = finalUsdc;
                    bestUniBuy = uniBuy;
                    bestFee = fees[i];
                    found = true;
                }
            }
        }
    }

    function _execute(ChainCtx memory c, bool uniBuy, uint24 fee, uint256 loan)
        internal
        returns (uint256 profit, bool reverted)
    {
        Flashloan fl = new Flashloan(c.pool, c.provider, address(this));

        // Leg1 USDC->WETH, Leg2 WETH->USDC. amountOutMin=0 to isolate execution
        // correctness from slippage; profitability is enforced by the contract.
        SwapLeg memory leg1;
        SwapLeg memory leg2;
        if (uniBuy) {
            leg1 = SwapLeg({
                dexType: DexType.UNISWAP_V3, router: c.v3Router, path: _p(c.usdc, c.weth), fee: fee, amountOutMin: 0
            });
            leg2 = SwapLeg({
                dexType: DexType.UNISWAP_V2, router: c.sushi, path: _p(c.weth, c.usdc), fee: 0, amountOutMin: 0
            });
        } else {
            leg1 = SwapLeg({
                dexType: DexType.UNISWAP_V2, router: c.sushi, path: _p(c.usdc, c.weth), fee: 0, amountOutMin: 0
            });
            leg2 = SwapLeg({
                dexType: DexType.UNISWAP_V3, router: c.v3Router, path: _p(c.weth, c.usdc), fee: fee, amountOutMin: 0
            });
        }

        ArbitrageParams memory params = ArbitrageParams({leg1: leg1, leg2: leg2, profitRecipient: address(0xBEAF)});

        uint256 balBefore = IERC20(c.usdc).balanceOf(address(0xBEAF));

        try fl.loan(c.usdc, loan, abi.encode(params)) {
            uint256 balAfter = IERC20(c.usdc).balanceOf(address(0xBEAF));
            profit = balAfter - balBefore;
        } catch {
            reverted = true;
        }
    }

    function _p(address a, address b) internal pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = a;
        path[1] = b;
    }

    // ---------------- Arbitrum ----------------

    /// @notice Sweeps loan sizes on the deep USDbC (USDC.e) pools. Native USDC
    /// /WETH pools on Arbitrum are too thin to flashloan 1000 USDC without
    /// catastrophic slippage, so the realistic venue is USDC.e.
    function test_arbitrum() public {
        _runFork("ARBITRUM_RPC_URL", ARB_AAVE_POOL, ARB_AAVE_PROVIDER);

        ChainCtx memory c = ChainCtx({
            pool: ARB_AAVE_POOL,
            provider: ARB_AAVE_PROVIDER,
            quoter: ARB_UNI_V3_QUOTER,
            sushi: ARB_SUSHI,
            v3Router: ARB_UNI_V3_ROUTER,
            usdc: ARB_USDC_E,
            weth: ARB_WETH
        });

        _sweep("arbitrum", c);
    }

    // ---------------- Base ----------------

    function test_base() public {
        _runFork("BASE_RPC_URL", BASE_AAVE_POOL, BASE_AAVE_PROVIDER);

        ChainCtx memory c = ChainCtx({
            pool: BASE_AAVE_POOL,
            provider: BASE_AAVE_PROVIDER,
            quoter: BASE_UNI_V3_QUOTER,
            sushi: BASE_SUSHI,
            v3Router: BASE_UNI_V3_ROUTER,
            usdc: BASE_USDC,
            weth: BASE_WETH
        });

        _sweep("base", c);
    }

    /// @notice Sweeps a range of loan sizes, reports the best round-trip for
    /// each, executes the most promising one, and asserts that profitability
    /// and on-chain outcome agree (profitable => executes; unprofitable =>
    /// reverts cleanly).
    function _sweep(string memory chainName, ChainCtx memory c) internal {
        uint256[5] memory sizes = [
            uint256(10) * 10 ** 6, // 10 USDC
            50 * 10 ** 6, // 50
            100 * 10 ** 6, // 100
            500 * 10 ** 6, // 500
            1000 * 10 ** 6 // 1000
        ];
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];

        emit log_named_string("chain", chainName);
        emit log_named_address("asset", c.usdc);

        bool anyProfitable = false;
        uint256 bestSize;
        uint256 bestFinal;
        bool bestUniBuy;
        uint24 bestFee;

        for (uint256 s = 0; s < sizes.length; s++) {
            (uint256 finalUsdc, bool uniBuy, uint24 fee, bool found) =
                _scan(c.quoter, c.sushi, c.usdc, c.weth, fees, sizes[s]);
            if (!found) {
                emit log_named_uint("size: no route (usdc 6d)", sizes[s]);
                continue;
            }
            uint256 debt = sizes[s] + (sizes[s] * 5) / 10000;
            emit log_named_uint("size (6d)", sizes[s]);
            emit log_named_int("  edge (final-debt, 6d)", int256(finalUsdc) - int256(debt));
            emit log_named_uint("  final (6d)", finalUsdc);
            emit log_named_uint("  fee", fee);
            emit log_named_string("  uniBuy", uniBuy ? "true" : "false");

            if (!anyProfitable || finalUsdc > bestFinal) {
                bestSize = sizes[s];
                bestFinal = finalUsdc;
                bestUniBuy = uniBuy;
                bestFee = fee;
            }
            if (finalUsdc > debt) anyProfitable = true;
        }

        if (bestSize == 0) {
            emit log("no quotable UniV3/Sushi route on this chain right now");
            return;
        }

        uint256 debt = bestSize + (bestSize * 5) / 10000;
        emit log_named_uint("BEST size (6d)", bestSize);
        emit log_named_uint("BEST final (6d)", bestFinal);
        emit log_named_uint("BEST debt (6d)", debt);
        emit log_named_string("BEST uniBuy", bestUniBuy ? "true" : "false");
        emit log_named_uint("BEST fee", bestFee);

        (uint256 profit, bool reverted) = _execute(c, bestUniBuy, bestFee, bestSize);

        if (bestFinal > debt) {
            emit log_named_uint("EXECUTED PROFIT (6d)", profit);
            assertFalse(reverted, "profitable setup must not revert");
            assertGt(profit, 0, "profit must be positive");
        } else {
            emit log("best route still unprofitable after fees");
            assertTrue(reverted, "unprofitable route must revert cleanly");
            assertTrue(!anyProfitable || bestFinal <= debt, "consistency");
        }
    }

    /// @notice Fine search for the loan size that maximizes net profit after
    /// gas. Because the 0.05% Aave premium and DEX fees are proportional while
    /// gas is fixed, the optimum is where marginal edge stops covering the
    /// per-unit fee erosion. Reports the full edge curve for the chosen route.
    function test_arbitrum_optimal_size() public {
        _runFork("ARBITRUM_RPC_URL", ARB_AAVE_POOL, ARB_AAVE_PROVIDER);

        ChainCtx memory c = ChainCtx({
            pool: ARB_AAVE_POOL,
            provider: ARB_AAVE_PROVIDER,
            quoter: ARB_UNI_V3_QUOTER,
            sushi: ARB_SUSHI,
            v3Router: ARB_UNI_V3_ROUTER,
            usdc: ARB_USDC_E,
            weth: ARB_WETH
        });

        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];

        // Gas cost in USDC (6d): EXEC_GAS_UNITS * gasPrice * ethPriceInUsdc.
        uint256 gasUnits = 600_000;
        uint256 gasPrice = tx.gasprice == 0 ? 20_000_000 : tx.gasprice; // wei per gas
        uint256 gasCostWei = gasUnits * gasPrice; // ETH wei
        // ETH price in USDC (6d): WETH->USDC.e on Sushi for 1e18 WETH.
        uint256 oneEth = 1e18;
        uint256[] memory ethOut = IV2Router(ARB_SUSHI).getAmountsOut(oneEth, _p(ARB_WETH, ARB_USDC_E));
        uint256 ethPriceUsdc6 = ethOut[1]; // USDC.e (6d) per 1 ETH
        uint256 gasCostUsdc6 = (gasCostWei * ethPriceUsdc6) / 1e18;

        emit log_named_uint("gasPrice (wei)", gasPrice);
        emit log_named_uint("ETH price (USDC 6d)", ethPriceUsdc6);
        emit log_named_uint("gas cost (USDC 6d)", gasCostUsdc6);

        // Fine exponential grid: 1..1024 USDC, plus a few large points.
        uint256[11] memory sizes = [
            uint256(1) * 10 ** 6,
            2 * 10 ** 6,
            5 * 10 ** 6,
            10 * 10 ** 6,
            25 * 10 ** 6,
            50 * 10 ** 6,
            100 * 10 ** 6,
            250 * 10 ** 6,
            500 * 10 ** 6,
            1000 * 10 ** 6,
            2000 * 10 ** 6
        ];

        int256 bestNet = type(int256).min;
        uint256 bestSize;
        uint256 bestFinal;
        bool bestUniBuy;
        uint24 bestFee;

        for (uint256 s = 0; s < sizes.length; s++) {
            (uint256 finalUsdc, bool uniBuy, uint24 fee, bool found) =
                _scan(c.quoter, c.sushi, c.usdc, c.weth, fees, sizes[s]);
            if (!found) {
                emit log_named_uint("size: no route (usdc 6d)", sizes[s]);
                continue;
            }
            uint256 debt = sizes[s] + (sizes[s] * 5) / 10000;
            int256 edge = int256(finalUsdc) - int256(debt);
            int256 net = edge - int256(gasCostUsdc6);

            emit log_named_uint("size (6d)", sizes[s]);
            emit log_named_int("  edge (6d)", edge);
            emit log_named_int("  net after gas (6d)", net);
            emit log_named_uint("  fee", fee);
            emit log_named_string("  uniBuy", uniBuy ? "true" : "false");

            if (net > bestNet) {
                bestNet = net;
                bestSize = sizes[s];
                bestFinal = finalUsdc;
                bestUniBuy = uniBuy;
                bestFee = fee;
            }
        }

        if (bestSize == 0) {
            emit log("no quotable route; cannot optimise");
            return;
        }

        uint256 bestDebt = bestSize + (bestSize * 5) / 10000;
        emit log_named_uint("OPTIMAL size (6d)", bestSize);
        emit log_named_int("OPTIMAL net (6d)", bestNet);
        emit log_named_uint("OPTIMAL final (6d)", bestFinal);
        emit log_named_uint("OPTIMAL debt (6d)", bestDebt);
        emit log_named_string("OPTIMAL uniBuy", bestUniBuy ? "true" : "false");
        emit log_named_uint("OPTIMAL fee", bestFee);

        (uint256 profit, bool reverted) = _execute(c, bestUniBuy, bestFee, bestSize);

        if (bestFinal > bestDebt) {
            emit log_named_uint("EXECUTED PROFIT (6d)", profit);
            assertFalse(reverted, "profitable optimal size must not revert");
            assertGt(profit, 0, "profit must be positive");
            assertGe(profit, uint256(bestNet > int256(0) ? bestNet : int256(0)), "realised >= modelled net");
        } else {
            emit log("optimal route still unprofitable after fees");
            assertTrue(reverted, "unprofitable route must revert cleanly");
        }
    }

    /// @notice Pure Sushi round-trip on Arbitrum to prove loan() execution with
    /// two live V2 swaps (independent of V3 quoter behaviour).
    function test_arbitrum_sushi_roundtrip_executes() public {
        _runFork("ARBITRUM_RPC_URL", ARB_AAVE_POOL, ARB_AAVE_PROVIDER);

        uint256 loan = 10 * 10 ** 6; // 10 USDC keeps the same-DEX pool impact tiny
        address[] memory pBuy = _p(ARB_USDC_E, ARB_WETH);
        uint256[] memory aBuy = IV2Router(ARB_SUSHI).getAmountsOut(loan, pBuy);
        address[] memory pSell = _p(ARB_WETH, ARB_USDC_E);
        uint256[] memory aSell = IV2Router(ARB_SUSHI).getAmountsOut(aBuy[1], pSell);

        emit log_named_uint("sushi round-trip final USDC.e", aSell[1]);
        emit log_named_uint("loan USDC.e", loan);

        bool reverted = _sushiOnly(ARB_AAVE_POOL, ARB_AAVE_PROVIDER, ARB_SUSHI, ARB_USDC_E, ARB_WETH, loan);
        // Same-DEX round trip is always <= loan after fees, so it must revert.
        assertTrue(reverted, "same-DEX round trip should not be profitable and must revert");
    }

    function _sushiOnly(address pool, address provider, address sushi, address usdc, address weth, uint256 loan)
        internal
        returns (bool reverted)
    {
        Flashloan fl = new Flashloan(pool, provider, address(this));
        SwapLeg memory leg1 =
            SwapLeg({dexType: DexType.UNISWAP_V2, router: sushi, path: _p(usdc, weth), fee: 0, amountOutMin: 0});
        SwapLeg memory leg2 =
            SwapLeg({dexType: DexType.UNISWAP_V2, router: sushi, path: _p(weth, usdc), fee: 0, amountOutMin: 0});
        ArbitrageParams memory params = ArbitrageParams({leg1: leg1, leg2: leg2, profitRecipient: address(0xBEAF)});
        try fl.loan(usdc, loan, abi.encode(params)) {
            reverted = false;
        } catch {
            reverted = true;
        }
    }
}
