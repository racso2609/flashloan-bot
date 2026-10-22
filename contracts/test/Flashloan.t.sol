// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Flashloan} from "../src/Flashloan.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPool, IPoolAddressesProvider} from "@aave-v3/misc/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
import {IUniswapV2Router02} from "../src/Flashloan.sol";
import {DexType, SwapLeg, ArbitrageParams} from "../src/Flashloan.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockUniswapV2Router is IUniswapV2Router02 {
    using SafeERC20 for IERC20;

    uint256 public constant RETURN_MULTIPLIER = 11; // 10% profit for testing
    address public lastTokenIn;
    uint256 public lastAmountIn;

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 _amountOutMin,
        address[] calldata path,
        address to,
        uint256 _deadline
    ) external override returns (uint256[] memory amounts) {
        lastTokenIn = path[0];
        lastAmountIn = amountIn;

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = (amounts[i - 1] * RETURN_MULTIPLIER) / 10;
        }

        // Mint tokens to recipient (simulating DEX swap)
        MockERC20(path[path.length - 1]).mint(to, amounts[path.length - 1]);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external pure returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = (amounts[i - 1] * RETURN_MULTIPLIER) / 10;
        }
    }
}

contract MockLossyRouter is IUniswapV2Router02 {
    using SafeERC20 for IERC20;

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 _amountOutMin,
        address[] calldata path,
        address to,
        uint256 _deadline
    ) external override returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        // Return 90% of input (10% loss)
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = (amounts[i - 1] * 9) / 10;
        }
        // Mint tokens to recipient (simulating DEX swap)
        MockERC20(path[path.length - 1]).mint(to, amounts[path.length - 1]);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external pure returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) {
            amounts[i] = (amounts[i - 1] * 9) / 10;
        }
    }
}

contract MockERC20 is IERC20 {
    using SafeERC20 for IERC20;

    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function totalSupply() external pure returns (uint256) {
        return 0; // Not needed for tests
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function forceApprove(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }
}

contract FlashloanTest is Test {
    Flashloan public flashloan;
    IERC20 public usdc;
    IPool public pool;
    IPoolAddressesProvider public provider;

    // Mainnet addresses
    address constant USDC_ADDRESS = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
    address constant AAVE_V3_PROVIDER = 0x2F39D218133AFAb8f2B819B1066Fc7E75012e9E9;

    // Test parameters
    uint256 constant LOAN_AMOUNT = 100 * 10 ** 6; // 100 USDC (6 decimals)
    uint256 public forkId;
    bool private skipFork;

    event LoanRequested(address asset, uint256 amount);
    event OperationExecuted(address asset, uint256 amount, uint256 premium);

    function setUp() public {
        // Check if we should skip fork (for basic tests)
        try vm.envString("SKIP_FORK") returns (string memory value) {
            skipFork = keccak256(bytes(value)) == keccak256(bytes("true"));
        } catch {
            skipFork = false;
        }

        // Create mainnet fork only if not skipping
        if (!skipFork) {
            string memory rpcUrl = vm.envString("MAINNET_RPC_URL");
            forkId = vm.createFork(rpcUrl);
            vm.selectFork(forkId);

            // Initialize contracts with real addresses
            usdc = IERC20(USDC_ADDRESS);
            pool = IPool(AAVE_V3_POOL);
            provider = IPoolAddressesProvider(AAVE_V3_PROVIDER);
        } else {
            // Skip fork setup for basic tests
            vm.label(AAVE_V3_POOL, "AaveV3Pool");
            vm.label(AAVE_V3_PROVIDER, "AaveV3Provider");
        }

        // Deploy Flashloan contract
        flashloan = new Flashloan(AAVE_V3_POOL, AAVE_V3_PROVIDER, address(this));
    }

    function _createArbitrageParams(
        address leg1Router,
        address leg1TokenIn,
        address leg1TokenOut,
        address leg2Router,
        address leg2TokenOut
    ) internal view returns (ArbitrageParams memory) {
        address[] memory leg1Path = new address[](2);
        leg1Path[0] = leg1TokenIn;
        leg1Path[1] = leg1TokenOut;

        address[] memory leg2Path = new address[](2);
        leg2Path[0] = leg1TokenOut;
        leg2Path[1] = leg2TokenOut;

        return ArbitrageParams({
            leg1: SwapLeg({
                dexType: DexType.UNISWAP_V2,
                router: leg1Router,
                path: leg1Path,
                fee: 0,
                amountOutMin: 0 // No slippage for tests
            }),
            leg2: SwapLeg({dexType: DexType.UNISWAP_V2, router: leg2Router, path: leg2Path, fee: 0, amountOutMin: 0}),
            profitRecipient: address(this)
        });
    }

    function testArbitrageWithMockRouters() public {
        // Deploy mock routers
        MockUniswapV2Router mockRouter = new MockUniswapV2Router();

        // Create test tokens (USDC and WETH mocks)
        MockERC20 mockUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        MockERC20 mockWETH = new MockERC20("Mock WETH", "mWETH", 18);

        // Create arbitrage params (USDC -> WETH -> USDC)
        ArbitrageParams memory arbParams = _createArbitrageParams(
            address(mockRouter), address(mockUSDC), address(mockWETH), address(mockRouter), address(mockUSDC)
        );

        // Mint some USDC to the flashloan contract for testing
        mockUSDC.mint(address(flashloan), 1000 * 10 ** 6);

        // Test that executeOperation works
        bytes memory params = abi.encode(arbParams);

        // We need to simulate being the Aave pool
        vm.prank(AAVE_V3_POOL);
        bool success = flashloan.executeOperation(
            address(mockUSDC),
            100 * 10 ** 6, // 100 USDC loan
            0, // 0 premium for testing
            address(flashloan),
            params
        );

        assertTrue(success, "Arbitrage execution should succeed");
    }

    function testExecuteOperationRevertsWhenInsufficientFunds() public {
        // Create test tokens
        MockERC20 mockUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        MockERC20 mockWETH = new MockERC20("Mock WETH", "mWETH", 18);

        // Create a mock router that returns only 90% (simulating loss)
        MockLossyRouter lossyRouter = new MockLossyRouter();

        ArbitrageParams memory arbParams = _createArbitrageParams(
            address(lossyRouter), address(mockUSDC), address(mockWETH), address(lossyRouter), address(mockUSDC)
        );

        // Mint some USDC to the flashloan contract
        mockUSDC.mint(address(flashloan), 1000 * 10 ** 6);

        bytes memory params = abi.encode(arbParams);

        // Should revert because swaps don't produce enough to repay
        vm.expectRevert("Not enough to repay loan");
        vm.prank(AAVE_V3_POOL);
        flashloan.executeOperation(
            address(mockUSDC),
            100 * 10 ** 6, // 100 USDC loan
            0, // 0 premium for testing
            address(flashloan),
            params
        );
    }

    function testProfitIsSentToRecipient() public {
        // Deploy mock routers
        MockUniswapV2Router mockRouter = new MockUniswapV2Router();

        // Create test tokens
        MockERC20 mockUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        MockERC20 mockWETH = new MockERC20("Mock WETH", "mWETH", 18);

        // Create a recipient address
        address recipient = address(0x1234);

        ArbitrageParams memory arbParams = ArbitrageParams({
            leg1: SwapLeg({
                dexType: DexType.UNISWAP_V2,
                router: address(mockRouter),
                path: new address[](2),
                fee: 0,
                amountOutMin: 0
            }),
            leg2: SwapLeg({
                dexType: DexType.UNISWAP_V2,
                router: address(mockRouter),
                path: new address[](2),
                fee: 0,
                amountOutMin: 0
            }),
            profitRecipient: recipient
        });

        arbParams.leg1.path[0] = address(mockUSDC);
        arbParams.leg1.path[1] = address(mockWETH);
        arbParams.leg2.path[0] = address(mockWETH);
        arbParams.leg2.path[1] = address(mockUSDC);

        // Mint some USDC to the flashloan contract
        uint256 initialAmount = 1000 * 10 ** 6;
        mockUSDC.mint(address(flashloan), initialAmount);

        // Get initial balance of recipient
        uint256 initialRecipientBalance = mockUSDC.balanceOf(recipient);

        bytes memory params = abi.encode(arbParams);

        // Execute operation
        vm.prank(AAVE_V3_POOL);
        flashloan.executeOperation(
            address(mockUSDC),
            100 * 10 ** 6, // 100 USDC loan
            0, // 0 premium for testing
            address(flashloan),
            params
        );

        // Check that profit was sent to recipient
        // With RETURN_MULTIPLIER = 11, 100 USDC -> 110 WETH -> 121 USDC
        // Profit = 121 - 100 = 21 USDC
        uint256 expectedProfit = 21 * 10 ** 6;
        uint256 finalRecipientBalance = mockUSDC.balanceOf(recipient);
        assertEq(finalRecipientBalance, initialRecipientBalance + expectedProfit, "Profit should be sent to recipient");
    }

    function testArbitrageParamsEncoding() public pure {
        // Test that ArbitrageParams can be encoded and decoded correctly
        address router1 = address(0x1111);
        address router2 = address(0x2222);
        address tokenA = address(0xAAAA);
        address tokenB = address(0xBBBB);
        address tokenC = address(0xCCCC);
        address recipient = address(0xDEAD);

        ArbitrageParams memory original = ArbitrageParams({
            leg1: SwapLeg({
                dexType: DexType.UNISWAP_V2, router: router1, path: new address[](2), fee: 3000, amountOutMin: 100
            }),
            leg2: SwapLeg({
                dexType: DexType.UNISWAP_V3, router: router2, path: new address[](2), fee: 500, amountOutMin: 200
            }),
            profitRecipient: recipient
        });

        original.leg1.path[0] = tokenA;
        original.leg1.path[1] = tokenB;
        original.leg2.path[0] = tokenB;
        original.leg2.path[1] = tokenC;

        // Encode
        bytes memory encoded = abi.encode(original);

        // Decode
        ArbitrageParams memory decoded = abi.decode(encoded, (ArbitrageParams));

        // Verify all fields
        assertEq(uint8(decoded.leg1.dexType), uint8(original.leg1.dexType), "leg1 dexType should match");
        assertEq(decoded.leg1.router, original.leg1.router, "leg1 router should match");
        assertEq(decoded.leg1.path.length, original.leg1.path.length, "leg1 path length should match");
        assertEq(decoded.leg1.path[0], original.leg1.path[0], "leg1 path[0] should match");
        assertEq(decoded.leg1.path[1], original.leg1.path[1], "leg1 path[1] should match");
        assertEq(decoded.leg1.fee, original.leg1.fee, "leg1 fee should match");
        assertEq(decoded.leg1.amountOutMin, original.leg1.amountOutMin, "leg1 amountOutMin should match");

        assertEq(uint8(decoded.leg2.dexType), uint8(original.leg2.dexType), "leg2 dexType should match");
        assertEq(decoded.leg2.router, original.leg2.router, "leg2 router should match");
        assertEq(decoded.leg2.path.length, original.leg2.path.length, "leg2 path length should match");
        assertEq(decoded.leg2.path[0], original.leg2.path[0], "leg2 path[0] should match");
        assertEq(decoded.leg2.path[1], original.leg2.path[1], "leg2 path[1] should match");
        assertEq(decoded.leg2.fee, original.leg2.fee, "leg2 fee should match");
        assertEq(decoded.leg2.amountOutMin, original.leg2.amountOutMin, "leg2 amountOutMin should match");

        assertEq(decoded.profitRecipient, original.profitRecipient, "profitRecipient should match");
    }

    function testFlashloanSuccess() public {
        // Fork-only: report as skipped so the suite never claims coverage it
        // did not get (a bare `return` would be counted as a pass).
        if (skipFork) vm.skip(true);

        // Check initial balance
        uint256 initialBalance = usdc.balanceOf(address(flashloan));
        assertEq(initialBalance, 0, "Initial balance should be zero");

        // Expect events
        vm.expectEmit(true, true, false, true);
        emit LoanRequested(USDC_ADDRESS, LOAN_AMOUNT);

        // Request flashloan
        vm.prank(address(this));
        flashloan.loan(USDC_ADDRESS, LOAN_AMOUNT, "");

        // Check final balance should be zero (loan was repaid)
        uint256 finalBalance = usdc.balanceOf(address(flashloan));
        assertEq(finalBalance, 0, "Final balance should be zero after repayment");
    }

    function testFlashloanApprovalMechanism() public {
        // Fork-only: report as skipped so the suite never claims coverage it
        // did not get (a bare `return` would be counted as a pass).
        if (skipFork) vm.skip(true);

        // This test focuses specifically on the approval mechanism
        vm.prank(address(this));
        flashloan.loan(USDC_ADDRESS, LOAN_AMOUNT, "");

        // If we get here without revert, the approval worked correctly
        assertTrue(true, "Flashloan approval mechanism works correctly");
    }

    function testEventEmissions() public {
        // Fork-only: report as skipped so the suite never claims coverage it
        // did not get (a bare `return` would be counted as a pass).
        if (skipFork) vm.skip(true);

        // Test LoanRequested event
        vm.expectEmit(true, true, false, true);
        emit LoanRequested(USDC_ADDRESS, LOAN_AMOUNT);

        // Test OperationExecuted event
        vm.expectEmit(true, true, true, true);
        emit OperationExecuted(USDC_ADDRESS, LOAN_AMOUNT, 0);

        vm.prank(address(this));
        flashloan.loan(USDC_ADDRESS, LOAN_AMOUNT, "");
    }

    function testUnauthorizedCallerFails() public {
        // Try to call executeOperation directly (should fail)
        vm.expectRevert("Caller must be Aave pool");
        vm.prank(address(0x123));
        flashloan.executeOperation(USDC_ADDRESS, LOAN_AMOUNT, 0, address(flashloan), "");
    }

    function testInvalidInitiatorFails() public {
        // Even if caller is pool, initiator must be this contract
        vm.expectRevert("Initiator must be this contract");
        vm.prank(AAVE_V3_POOL);
        flashloan.executeOperation(USDC_ADDRESS, LOAN_AMOUNT, 0, address(0x123), "");
    }

    function testOnlyOwnerCanRequestLoan() public {
        // Test that non-owner cannot request loan
        address nonOwner = address(0x456);
        vm.expectRevert();
        vm.prank(nonOwner);
        flashloan.loan(USDC_ADDRESS, LOAN_AMOUNT, "");
    }

    function testZeroLoanAmount() public {
        // Fork-only: report as skipped so the suite never claims coverage it
        // did not get (a bare `return` would be counted as a pass).
        if (skipFork) vm.skip(true);

        // Test edge case with zero loan amount
        vm.expectEmit(true, true, false, true);
        emit LoanRequested(USDC_ADDRESS, 0);

        vm.prank(address(this));
        flashloan.loan(USDC_ADDRESS, 0, "");
    }

    // Basic test that doesn't require fork
    function testContractDeployment() public view {
        assertTrue(address(flashloan) != address(0), "Flashloan contract should be deployed");
        assertEq(flashloan.owner(), address(this), "Owner should be set correctly");
    }
}
