# Flashloan Test Instructions

## Running the Tests

### Basic Tests (No Fork Required)
These tests validate contract security and basic functionality:
```bash
SKIP_FORK=true forge test -vvv
```

### Full Mainnet Fork Tests
To run the complete test suite with mainnet forking:

1. **Set up environment variable:**
   ```bash
   export MAINNET_RPC_URL="https://eth-mainnet.alchemyapi.io/v2/YOUR_API_KEY"
   ```
   Or use any other mainnet RPC provider (Infura, QuickNode, etc.)

2. **Run all tests:**
   ```bash
   forge test --fork-url $MAINNET_RPC_URL -vvv
   ```

   Or with environment variable:
   ```bash
   forge test -vvv
   ```

### Specific Test Scenarios

#### Run only security tests:
```bash
SKIP_FORK=true forge test --match-test testUnauthorizedCallerFails --match-test testOnlyOwnerCanRequestLoan -vvv
```

#### Run only fork tests:
```bash
forge test --match-test testFlashloanSuccess --match-test testFlashloanApprovalMechanism --fork-url $MAINNET_RPC_URL -vvv
```

## Test Coverage

### Security Tests
- ✅ `testUnauthorizedCallerFails`: Ensures only Aave pool can call `executeOperation`
- ✅ `testInvalidInitiatorFails`: Ensures only contract can initiate flashloan
- ✅ `testOnlyOwnerCanRequestLoan`: Ensures only owner can request loans
- ✅ `testContractDeployment`: Validates proper contract setup

### Mainnet Fork Tests
- ✅ `testFlashloanSuccess`: Complete 100 USDC flashloan flow
- ✅ `testFlashloanApprovalMechanism`: Focuses on approval verification
- ✅ `testEventEmissions`: Validates proper event emissions
- ✅ `testZeroLoanAmount`: Edge case testing

## What the Tests Validate

1. **Approval Mechanism**: The `executeOperation` correctly approves the Aave pool for repayment
2. **Complete Flow**: Loan request → execution → repayment works end-to-end
3. **Security**: Only authorized addresses can call critical functions
4. **Event Emissions**: Proper logging of loan operations
5. **Edge Cases**: Zero amounts and unauthorized access scenarios

## Requirements

- Foundry installed
- Mainnet RPC URL (Alchemy, Infura, QuickNode, etc.)
- 100 USDC loan amount for testing

## Expected Results

- All security tests should pass without RPC URL
- Fork tests require valid mainnet RPC connection
- Total gas usage: ~50-80k for complete test suite