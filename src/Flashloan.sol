// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFlashLoanSimpleReceiver, IPool, IPoolAddressesProvider} from "@aave-v3/misc/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Flashloan is IFlashLoanSimpleReceiver, Ownable {
    using SafeERC20 for IERC20;

    IPool public POOL;
    IPoolAddressesProvider public ADDRESSES_PROVIDER;

    event LoanRequested(address asset, uint256 amount);
    event OperationExecuted(address asset, uint256 amount, uint256 premium);

    constructor(
        address poolAddress,
        address provider,
        address initialOwner
    ) Ownable(initialOwner) {
        POOL = IPool(poolAddress);
        ADDRESSES_PROVIDER = IPoolAddressesProvider(provider);
    }

    function loan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner {
        // request loan

        emit LoanRequested(asset, amount);
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Implement your logic here
        require(msg.sender == address(POOL), "Caller must be Aave pool");
        require(initiator == address(this), "Initiator must be this contract");

        // get path to swap
        // 1) Your strategy here (decode params, do swaps, etc.)
        // Example:
        // (address someRouter, uint256 minOut) = abi.decode(params, (address, uint256));
        // ... do work ...

        uint256 amountToRePay = amount + premium;
        IERC20(asset).forceApprove(address(POOL), amountToRePay);

        emit OperationExecuted(asset, amount, premium);
        // Return true to indicate successful execution
        return true;
    }

    function rescueToken(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
