#!/bin/bash
# ============================================
# Flashloan Contract Deployment Script
# For Arbitrum One
# ============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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
    echo "  Please copy .env.example to .env and fill in your values"
    exit 1
fi

# Check required variables
if [ -z "$PRIVATE_KEY" ] || [ "$PRIVATE_KEY" = "0xYOUR_PRIVATE_KEY_HERE" ]; then
    echo -e "${RED}✗${NC} PRIVATE_KEY not set in .env"
    exit 1
fi

if [ -z "$ARBITRUM_RPC_URL" ]; then
    echo -e "${RED}✗${NC} ARBITRUM_RPC_URL not set in .env"
    exit 1
fi

# Get deployer address
DEPLOYER=$(cast wallet address --private-key $PRIVATE_KEY 2>/dev/null || echo "unknown")
echo -e "${BLUE}Deployer:${NC} $DEPLOYER"

# Check deployer balance
BALANCE=$(cast balance $DEPLOYER --rpc-url $ARBITRUM_RPC_URL 2>/dev/null || echo "0")
BALANCE_ETH=$(echo "scale=4; $BALANCE / 1000000000000000000" | bc)
echo -e "${BLUE}Balance:${NC}  $BALANCE_ETH ETH"

# Check if balance is sufficient (need at least 0.005 ETH)
MIN_BALANCE="5000000000000000"  # 0.005 ETH in wei
if [ "$BALANCE" -lt "$MIN_BALANCE" ]; then
    echo -e "${YELLOW}⚠${NC} Low balance! You need at least 0.005 ETH for deployment"
    echo "  Get ETH on Arbitrum: https://bridge.arbitrum.io"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo -e "${YELLOW}Deploying contract...${NC}"
echo ""

# Deploy with or without verification (use script profile for via-ir)
if [ -n "$ARBISCAN_API_KEY" ] && [ "$ARBISCAN_API_KEY" != "YOUR_ARBISCAN_API_KEY" ]; then
    echo -e "${GREEN}✓${NC} Arbiscan API key found, will verify contract..."
    FOUNDRY_PROFILE=script forge script script/DeployFlashloan.s.sol:DeployFlashloanScript \
        --rpc-url $ARBITRUM_RPC_URL \
        --private-key $PRIVATE_KEY \
        --broadcast \
        --verify \
        --etherscan-api-key $ARBISCAN_API_KEY \
        --chain-id 42161 \
        -vvvv
else
    echo -e "${YELLOW}⚠${NC} No Arbiscan API key, skipping verification..."
    FOUNDRY_PROFILE=script forge script script/DeployFlashloan.s.sol:DeployFlashloanScript \
        --rpc-url $ARBITRUM_RPC_URL \
        --private-key $PRIVATE_KEY \
        --broadcast \
        --chain-id 42161 \
        -vvvv
fi

echo ""
echo -e "${GREEN}"
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo -e "${NC}"

# Check if deployment info was saved
if [ -f "deployments/flashloan-arbitrum.json" ]; then
    echo -e "${BLUE}Deployment info:${NC}"
    cat deployments/flashloan-arbitrum.json
    echo ""
fi

echo -e "${YELLOW}Next steps:${NC}"
echo "1. Copy the contract address above"
echo "2. Add it to your bot/.env file:"
echo "   FLASHLOAN_CONTRACT=0xYourContractAddress"
echo "3. Start the bot with: cd bot && npm start"
echo ""
