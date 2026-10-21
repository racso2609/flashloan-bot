// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/Flashloan.sol";

/**
 * Deployment script for Flashloan contract on Arbitrum
 *
 * Usage:
 *   FOUNDRY_PROFILE=script forge script script/DeployFlashloan.s.sol:DeployFlashloanScript \
 *     --rpc-url $ARBITRUM_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 *
 * Verify on Arbiscan:
 *   FOUNDRY_PROFILE=script forge script script/DeployFlashloan.s.sol:DeployFlashloanScript \
 *     --rpc-url $ARBITRUM_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $ARBISCAN_API_KEY \
 *     -vvvv
 */
contract DeployFlashloanScript is Script {
    // Aave V3 Addresses on Arbitrum One
    address constant AAVE_V3_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant AAVE_V3_PROVIDER = 0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb;

    function run() external returns (Flashloan) {
        // Get deployer from environment
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));

        console.log("=================================");
        console.log("Flashloan Contract Deployment");
        console.log("=================================");
        console.log("Network:      Arbitrum One");
        console.log("Chain ID:     42161");
        console.log("Deployer:     ", vm.toString(deployer));
        console.log("Aave Pool:    ", vm.toString(AAVE_V3_POOL));
        console.log("Aave Provider: ", vm.toString(AAVE_V3_PROVIDER));
        console.log("---------------------------------");

        // Start broadcast
        vm.startBroadcast();

        // Deploy the contract
        Flashloan flashloan = new Flashloan(
            AAVE_V3_POOL,
            AAVE_V3_PROVIDER,
            deployer // initialOwner
        );

        vm.stopBroadcast();

        // Log deployment info
        console.log("=================================");
        console.log("Deployment Successful!");
        console.log("=================================");
        console.log("Contract Address: ", vm.toString(address(flashloan)));
        console.log("=================================");
        console.log("");
        console.log("Add this to your bot/.env file:");
        console.log("FLASHLOAN_CONTRACT=", vm.toString(address(flashloan)));
        console.log("");
        console.log("View on Arbiscan:");
        console.log("https://arbiscan.io/address/", vm.toString(address(flashloan)));
        console.log("=================================");

        return flashloan;
    }
}
