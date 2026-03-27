// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/Flashloan.sol";

/**
 * Deployment script for Flashloan contract on Base
 * 
 * Usage:
 *   FOUNDRY_PROFILE=script forge script script/DeployBase.s.sol:DeployBaseScript \
 *     --rpc-url $BASE_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 * 
 * Verify on Basescan:
 *   FOUNDRY_PROFILE=script forge script script/DeployBase.s.sol:DeployBaseScript \
 *     --rpc-url $BASE_RPC_URL \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $BASESCAN_API_KEY \
 *     -vvvv
 */
contract DeployBaseScript is Script {
    // Aave V3 Addresses on Base
    address constant AAVE_V3_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant AAVE_V3_PROVIDER = 0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D;

    function run() external returns (Flashloan) {
        // Get deployer from environment
        address deployer = vm.addr(vm.envUint("PRIVATE_KEY"));
        
        console.log("=================================");
        console.log("Flashloan Contract Deployment");
        console.log("=================================");
        console.log("Network:      Base Mainnet");
        console.log("Chain ID:     8453");
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
            deployer  // initialOwner
        );

        vm.stopBroadcast();

        // Log deployment info
        console.log("=================================");
        console.log("Deployment Successful!");
        console.log("=================================");
        console.log("Contract Address: ", vm.toString(address(flashloan)));
        console.log("=================================");
        console.log("");
        console.log("Update your bot/.env file:");
        console.log("FLASHLOAN_CONTRACT=", vm.toString(address(flashloan)));
        console.log("");
        console.log("View on Basescan:");
        console.log("https://basescan.org/address/", vm.toString(address(flashloan)));
        console.log("=================================");

        return flashloan;
    }
}
