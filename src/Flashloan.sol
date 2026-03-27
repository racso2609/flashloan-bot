// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    IFlashLoanSimpleReceiver,
    IPool,
    IPoolAddressesProvider
} from "@aave-v3/misc/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Type of DEX router
enum DexType {
    UNISWAP_V2, // Also works for SushiSwap
    UNISWAP_V3
}

/// @notice Swap instruction for a single leg
struct SwapLeg {
    DexType dexType;
    address router;
    address[] path;
    // Token path [tokenIn, tokenOut] or [A, B, C]
    uint256 fee;
    // Uniswap V3 fee tier (e.g., 3000 for 0.3%), 0 for V2
    uint256 amountOutMin;
    // Minimum output (slippage protection)
}

/// @notice Complete arbitrage instruction
struct ArbitrageParams {
    SwapLeg leg1; // First swap (borrowed token → middle token)
    SwapLeg leg2; // Second swap (middle token → borrowed token)
    address profitRecipient; // Where to send profits
}

contract Flashloan is IFlashLoanSimpleReceiver, Ownable {
    using SafeERC20 for IERC20;

    IPool public POOL;
    IPoolAddressesProvider public ADDRESSES_PROVIDER;

    event LoanRequested(address asset, uint256 amount);
    event OperationExecuted(address asset, uint256 amount, uint256 premium, uint256 profit);

    constructor(address poolAddress, address provider, address initialOwner) Ownable(initialOwner) {
        POOL = IPool(poolAddress);
        ADDRESSES_PROVIDER = IPoolAddressesProvider(provider);
    }

    function loan(address asset, uint256 amount, bytes calldata params) external onlyOwner {
        // request loan

        emit LoanRequested(asset, amount);
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        override
        returns (bool)
    {
        require(msg.sender == address(POOL), "Caller must be Aave pool");
        require(initiator == address(this), "Initiator must be this contract");

        // Decode arbitrage params
        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));

        // Step 1: Execute first swap (borrowed token → middle token)
        uint256 amountAfterLeg1 = _executeSwap(asset, amount, arbParams.leg1);

        // Step 2: Execute second swap (middle token → borrowed token)
        uint256 amountAfterLeg2 =
            _executeSwap(arbParams.leg1.path[arbParams.leg1.path.length - 1], amountAfterLeg1, arbParams.leg2);

        // Step 4: Verify we have enough to repay
        uint256 amountToRepay = amount + premium;
        require(amountAfterLeg2 >= amountToRepay, "Not enough to repay loan");

        // Step 5: Calculate profit and transfer
        uint256 profit = amountAfterLeg2 - amountToRepay;
        if (profit > 0 && arbParams.profitRecipient != address(0)) {
            IERC20(asset).safeTransfer(arbParams.profitRecipient, profit);
        }

        // Step 6: Approve pool for repayment
        IERC20(asset).forceApprove(address(POOL), amountToRepay);

        emit OperationExecuted(asset, amount, premium, profit);
        return true;
    }

    function _executeSwap(address tokenIn, uint256 amountIn, SwapLeg memory leg) internal returns (uint256 amountOut) {
        // Approve router to spend tokens
        IERC20(tokenIn).forceApprove(leg.router, amountIn);

        if (leg.dexType == DexType.UNISWAP_V2) {
            // Uniswap V2 / SushiSwap swap
            IUniswapV2Router02 router = IUniswapV2Router02(leg.router);
            uint256[] memory amounts =
                router.swapExactTokensForTokens(amountIn, leg.amountOutMin, leg.path, address(this), block.timestamp);
            amountOut = amounts[amounts.length - 1];
        } else if (leg.dexType == DexType.UNISWAP_V3) {
            // Uniswap V3 swap
            ISwapRouter router = ISwapRouter(leg.router);
            amountOut = router.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: leg.path[leg.path.length - 1],
                    fee: uint24(leg.fee),
                    recipient: address(this),
                    deadline: block.timestamp,
                    amountIn: amountIn,
                    amountOutMinimum: leg.amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        }
    }

    function rescueToken(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
