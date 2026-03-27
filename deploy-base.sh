#!/bin/bash
# ============================================
# Flashloan Contract Deployment Script
# For Base Network
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "=========================================="
echo "  Flashloan Contract Deployment"
echo "  Network: Base (Chain ID: 8453)"
echo "=========================================="
echo -e "${NC}"

# Load environment variables
if [ -f .env ]; then
    echo -e "${GREEN}✓${NC} Loading .env file..."
    export $(grep -v '^#' .env | xargs)
else
    echo -e "${RED}✗${NC} .env file not found!"
    echo "  Copy .env.base.example to .env and fill in your values"
    exit 1
fi

# Validate
if [ -z "$PRIVATE_KEY" ] || [ "$PRIVATE_KEY" = "0xYOUR_PRIVATE_KEY_HERE" ]; then
    echo -e "${RED}✗${NC} PRIVATE_KEY not set"
    exit 1
fi

# Get deployer
DEPLOYER=$(cast wallet address --private-key $PRIVATE_KEY 2>/dev/null || echo "unknown")
echo -e "${BLUE}Deployer:${NC} $DEPLOYER"

# Check balance
BALANCE=$(cast balance $DEPLOYER --rpc-url $BASE_RPC_URL 2>/dev/null || echo "0")
BALANCE_ETH=$(echo "scale=6; $BALANCE / 1000000000000000000" | bc 2>/dev/null || echo "0")
echo -e "${BLUE}Balance:${NC}  $BALANCE_ETH ETH"

if [ "$BALANCE_ETH" = "0" ] || [ $(echo "$BALANCE_ETH < 0.001" | bc 2>/dev/null || echo "1") -eq 1 ]; then
    echo -e "${YELLOW}⚠${NC} Low balance! Need at least 0.001 ETH for gas"
    echo "  Get ETH on Base: https://bridge.base.org"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

echo ""
echo -e "${YELLOW}Deploying to Base...${NC}"
echo ""

# Deploy
if [ -n "$BASESCAN_API_KEY" ] && [ "$BASESCAN_API_KEY" != "YOUR_BASESCAN_API_KEY" ]; then
    echo -e "${GREEN}✓${NC} Will verify on Basescan"
    FOUNDRY_PROFILE=script forge script script/DeployBase.s.sol:DeployBaseScript \
        --rpc-url "${BASE_RPC_URL:-https://mainnet.base.org}" \
        --private-key $PRIVATE_KEY \
        --broadcast \
        --verify \
        --etherscan-api-key $BASESCAN_API_KEY \
        --chain-id 8453 \
        -vvvv
else
    echo -e "${YELLOW}⚠${NC} Skipping verification (no API key)"
    FOUNDRY_PROFILE=script forge script script/DeployBase.s.sol:DeployBaseScript \
        --rpc-url "${BASE_RPC_URL:-https://mainnet.base.org}" \
        --private-key $PRIVATE_KEY \
        --broadcast \
        --chain-id 8453 \
        -vvvv
fi

echo ""
echo -e "${GREEN}=========================================="
echo "  Deployment Complete!"
echo "==========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy contract address from output above"
echo "2. Update .env with FLASHLOAN_CONTRACT=0x..."
echo "3. Copy config.base.js to config.js for bot"
echo "4. Start bot: cd bot && npm start"
echo ""
