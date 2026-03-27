#!/bin/bash
# ============================================
# Flashloan Contract Deployment Script
# For Arbitrum One
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
echo "  Network: Arbitrum One (Chain ID: 42161)"
echo "=========================================="
echo -e "${NC}"

# Load environment variables
if [ -f .env ]; then
    echo -e "${GREEN}✓${NC} Loading .env file..."
    export $(grep -v '^#' .env | xargs)
else
    echo -e "${RED}✗${NC} .env file not found!"
    echo "  Copy .env.example to .env and fill in your values"
    exit 1
fi

# Check required variables
if [ -z "$PRIVATE_KEY" ] || [ "$PRIVATE_KEY" = "0xYOUR_PRIVATE_KEY_HERE" ]; then
    echo -e "${RED}✗${NC} PRIVATE_KEY not set in .env"
    exit 1
fi

# Get deployer address
DEPLOYER=$(cast wallet address --private-key $PRIVATE_KEY 2>/dev/null || echo "unknown")
echo -e "${BLUE}Deployer:${NC} $DEPLOYER"

# Check deployer balance
BALANCE=$(cast balance $DEPLOYER --rpc-url $ARBITRUM_RPC_URL 2>/dev/null || echo "0")
BALANCE_ETH=$(echo "scale=6; $BALANCE / 1000000000000000000" | bc 2>/dev/null || echo "0")
echo -e "${BLUE}Balance:${NC}  $BALANCE_ETH ETH"

if [ "$BALANCE_ETH" = "0" ] || [ $(echo "$BALANCE_ETH < 0.01" | bc 2>/dev/null || echo "1") -eq 1 ]; then
    echo -e "${YELLOW}⚠${NC} Low balance! Need at least 0.01 ETH for gas"
    echo "  Get ETH on Arbitrum: https://bridge.arbitrum.io"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

echo ""
echo -e "${YELLOW}Deploying to Arbitrum...${NC}"
echo ""

# Deploy
FOUNDRY_PROFILE=script forge script script/DeployFlashloan.s.sol:DeployFlashloanScript \
    --rpc-url "$ARBITRUM_RPC_URL" \
    --private-key $PRIVATE_KEY \
    --broadcast \
    --chain-id 42161 \
    -vvvv

echo ""
echo -e "${GREEN}=========================================="
echo "  Deployment Complete!"
echo "==========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy contract address from output above"
echo "2. Update bot/.env with FLASHLOAN_CONTRACT=0x..."
echo "3. Start bot: cd bot && npm start arbitrum"
echo ""
