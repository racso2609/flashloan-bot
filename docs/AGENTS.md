# Agent Coding Guidelines for Flashloan Bot

This document provides guidelines for autonomous coding agents working on this Foundry/Solidity project.

---

## Build, Test & Development Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `forge build` | Compile all contracts |
| `forge test` | Run all tests |
| `forge test -vvv` | Run tests with verbose output |
| `forge fmt` | Format Solidity code |
| `forge coverage` | Generate coverage report |

### Running a Single Test

```bash
# Run specific test by name
forge test --match-test testFlashloanSuccess -vvv

# Run multiple specific tests
forge test --match-test testUnauthorizedCallerFails --match-test testOnlyOwnerCanRequestLoan -vvv

# Run tests matching a pattern
forge test --match-path "test/Flashloan.t.sol" -vvv
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MAINNET_RPC_URL` | For fork tests | Mainnet RPC (Alchemy, Infura, etc.) |
| `SKIP_FORK` | No | Set to "true" to skip fork tests |

### Testing Modes

```bash
# Basic security tests (no fork required)
SKIP_FORK=true forge test -vvv

# Full tests with mainnet fork
forge test -vvv  # Requires MAINNET_RPC_URL

# Run against specific fork
forge test --fork-url $MAINNET_RPC_URL -vvv
```

---

## Project Structure

```
contracts/                 # Foundry project (this directory)
├── src/                 # Source contracts
│   └── Flashloan.sol     # Main flashloan contract
├── test/                # Test files
│   └── Flashloan.t.sol  # Comprehensive tests
├── lib/                 # Dependencies (git submodules)
│   ├── aave-v3-origin  # Aave V3 interfaces
│   ├── openzeppelin-contracts/
│   └── forge-std/
├── remappings.txt       # Import aliases
└── foundry.toml         # Foundry config
```

---

## Import Remappings

This project uses the following import aliases:

```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
@aave-v3/=lib/aave-v3-origin/src/contracts/
```

Use these in your imports:
```solidity
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IFlashLoanSimpleReceiver} from "@aave-v3/misc/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
```

---

## Code Style Guidelines

### Formatting

- **Line length**: Keep lines under 80 characters when practical
- **Indentation**: 4 spaces (not tabs)
- **Blank lines**: Single blank line between top-level declarations
- **Run formatter**: Always run `forge fmt` before committing

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Contracts | PascalCase | `Flashloan`, `FlashloanTest` |
| Functions | camelCase | `executeOperation`, `rescueToken` |
| Variables | camelCase | `poolAddress`, `loanAmount` |
| Constants | UPPER_SNAKE_CASE | `LOAN_AMOUNT`, `USDC_ADDRESS` |
| Events | PascalCase with past tense | `LoanRequested`, `OperationExecuted` |
| Errors | PascalCase with "Error" suffix | `UnauthorizedCallerError` |
| Storage variables | camelCase with visibility | `IPool public POOL` |

### Contract Structure

Order contract contents as follows:
1. SPDX license identifier
2. Pragma statement
3. Import statements
4. Interface declarations (if any)
5. Contract declaration
6. State variables (events, immutables, storage)
7. Constructor
8. External functions
9. Public functions
10. Internal functions
11. Private functions
12. Modifiers

### Import Organization

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

// OpenZeppelin imports (alphabetical within category)
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Aave imports
import {IFlashLoanSimpleReceiver, IPool} from "@aave-v3/misc/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";

// Local imports
import {SomeLocalContract} from "./SomeLocalContract.sol";
```

### Types and Safety

- **Pragma**: Use `^0.8.13` minimum
- **Explicit types**: Always declare types explicitly (e.g., `uint256`, not `uint`)
- **Address type**: Use `address` for addresses, `address payable` when sending ETH
- **Gas optimization**: Use `calldata` for read-only bytes parameters
- **Immutables**: Mark constants that are set in constructor as `immutable`

### Access Control

- **Ownable pattern**: Use OpenZeppelin's Ownable for contract ownership
- **Function modifiers**: Create descriptive modifiers like `onlyOwner`, `onlyPool`
- **Zero address checks**: Validate addresses in constructor and setters
- **Events**: Emit events for all state-changing operations

### Error Handling

```solidity
// Custom errors (preferred for Solidity 0.8+)
error UnauthorizedCaller();
error InvalidAmount();

// Require with custom errors
if (msg.sender != address(POOL)) {
    revert UnauthorizedCaller();
}

// Require with messages (legacy, still acceptable)
require(msg.sender == address(POOL), "Caller must be Aave pool");
```

### Testing Guidelines

- **Test naming**: Use descriptive names `testFlashloanSuccess`, `testUnauthorizedCallerFails`
- **Arrange-Act-Assert**: Structure tests clearly
- **Fork tests**: Use `SKIP_FORK=true` for basic tests, require `MAINNET_RPC_URL` for integration
- **Assertions**: Use specific assertions (`assertEq`, `assertTrue`) with descriptive messages
- **Events**: Use `vm.expectEmit()` for event testing

### Security Considerations

- **Reentrancy**: Use checks-effects-interactions pattern
- **Approval management**: Use SafeERC20 for token approvals
- **Access control**: Validate caller permissions on sensitive functions
- **Input validation**: Validate all input parameters

---

## Testing New Code

Before submitting changes:
1. Run `forge fmt` to format code
2. Run `SKIP_FORK=true forge test -vvv` for security tests
3. Run full tests with `forge test -vvv` (requires MAINNET_RPC_URL)
4. Verify no new compiler warnings

---

## Common Patterns

### Flashloan Implementation

```solidity
contract ExampleFlashloan is IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller must be pool");
        require(initiator == address(this), "Initiator must be this");

        // Your logic here

        // Repay
        IERC20(asset).forceApprove(address(POOL), amount + premium);
        return true;
    }
}
```

### Testing with Fork

```solidity
function setUp() public {
    string memory rpcUrl = vm.envString("MAINNET_RPC_URL");
    forkId = vm.createFork(rpcUrl);
    vm.selectFork(forkId);
}
```
