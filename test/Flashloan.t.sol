// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Flashloan} from "../src/Flashloan.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPool, IPoolAddressesProvider} from "@aave-v3/misc/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";

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
    uint256 constant LOAN_AMOUNT = 100 * 10**6; // 100 USDC (6 decimals)
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

    function testFlashloanSuccess() public {
        // Only run with fork
        if (skipFork) return;
        
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
        // Only run with fork
        if (skipFork) return;
        
        // This test focuses specifically on the approval mechanism
        vm.prank(address(this));
        flashloan.loan(USDC_ADDRESS, LOAN_AMOUNT, "");

        // If we get here without revert, the approval worked correctly
        assertTrue(true, "Flashloan approval mechanism works correctly");
    }

    function testEventEmissions() public {
        // Only run with fork
        if (skipFork) return;
        
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
        // Only run with fork
        if (skipFork) return;
        
        // Test edge case with zero loan amount
        vm.expectEmit(true, true, false, true);
        emit LoanRequested(USDC_ADDRESS, 0);

        vm.prank(address(this));
        flashloan.loan(USDC_ADDRESS, 0, "");
    }

    // Basic test that doesn't require fork
    function testContractDeployment() public {
        assertTrue(address(flashloan) != address(0), "Flashloan contract should be deployed");
        assertEq(flashloan.owner(), address(this), "Owner should be set correctly");
    }
}