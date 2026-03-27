# Liquidations Bot - Architectural Plan

## 1. Overview

### What are Liquidations?
When a user borrows from a lending protocol (Aave, Compound, etc.), they must maintain a **health factor**. If the value of their collateral drops relative to their debt, anyone can **liquidate** their position and earn a **liquidation bonus** (typically 5-15% of collateral).

### The Opportunity
- Monitor health factors across lending markets
- When position becomes unhealthy → execute liquidation
- Earn the bonus (profit = collateral value - debt repaid - gas)
- Requires capital to repay debt and receive collateral

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LIQUIDATION BOT                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   Data       │───▶│   Strategy  │───▶│   Executor   │          │
│  │   Ingestion  │    │   Engine     │    │   Module     │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                   │                  │
│         ▼                   ▼                   ▼                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │  Chain RPC   │    │  Market      │    │  Wallet/     │          │
│  │  Indexer     │    │  Data        │    │  Gas Mgmt   │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Data Ingestion Layer

**Purpose:** Collect real-time data from blockchain and APIs

| Component | Description | Technologies |
|-----------|-------------|--------------|
| **RPC Client** | Connect to chain nodes | Alchemy, Infura, custom |
| **Event Listener** | Monitor liquidation events | The Graph, custom indexing |
| **Price Feed** | Get asset prices for health calculation | Chainlink, Uniswap TWAP |
| **Position Scanner** | Scan all borrower positions | Subgraph, direct RPC calls |

**Data Sources:**
- Aave V3 Subgraph: `https://thegraph.com/hosted-service/subgraph/aave/aave-v3-{network}`
- Compound V3: `https://thegraph.com/hosted-service/subgraph/compound-finance/compound-v3-{network}`
- Price feeds: Chainlink data feeds, or custom TWAP from DEXes

---

### 3.2 Strategy Engine

**Purpose:** Determine which positions to liquidate and when

```
┌─────────────────────────────────────────────────────────────┐
│                     STRATEGY ENGINE                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Input:                                                      │
│  - All positions with health factor < threshold            │
│  - Current gas prices                                        │
│  - Asset prices                                              │
│  - Your available capital                                    │
│                                                              │
│  Decision Logic:                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. Filter: healthFactor < 1.0 (liquidatable)        │   │
│  │  2. Calculate: profit = bonus - gas - slippage        │   │
│  │  3. Filter: profit > minProfitThreshold              │   │
│  │  4. Sort: by profit descending                        │   │
│  │  5. Select: top N positions (based on capital)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Output:                                                    │
│  - List of positions to liquidate                           │
│  - Estimated profit per position                            │
│  - Gas cost estimate                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Calculations:**
```
healthFactor = (collateralValue * liquidationThreshold) / totalBorrows

profit = (liquidatedCollateral * (1 + bonusRate)) - debtRepaid - gasCost - slippage

profitable = profit > minimumProfitThreshold
```

---

### 3.3 Executor Module

**Purpose:** Execute liquidation transactions on-chain

**Workflow:**
1. **Build Transaction**
   - Call liquidation function on lending protocol
   - Specify: borrower, collateralAsset, debtAsset, amount

2. **Gas Management**
   - Set appropriate gas limit
   - Use dynamic gas strategy (e.g., fast mode during high competition)

3. **Simulate First**
   - Use `eth_call` to simulate transaction
   - Ensure it succeeds before submitting

4. **Submit Transaction**
   - Send to mempool (or use Flashbots for privacy)
   - Monitor for inclusion

5. **Handle Failures**
   - Revert if simulation fails
   - Retry with adjusted params
   - Log failures for analysis

---

### 3.4 Wallet & Capital Management

**Purpose:** Manage funds for executing liquidations

**Requirements:**
- **Native token (ETH/ETH)** - For gas
- **Debt token** - To repay the borrowed position
- **Collateral token** - Received after liquidation

**Capital Strategy:**
- Maintain buffer of gas token
- Keep debt tokens ready for liquidations
- Auto-swap collateral → debt token after liquidation
- Track profit/loss per position

---

## 4. Data Flow

```
1. PRICE FEEDS
   ┌─────────────┐
   │ Chainlink  │ ──┐
   │ Uniswap    │ ──┤
   └─────────────┘   │
                     ▼
2. POSITION DATA
   ┌─────────────┐
   │ Subgraph    │ ──▶ All positions with health factor
   │ RPC Events  │ ──▶ Real-time updates
   └─────────────┘
                     │
                     ▼
3. STRATEGY ENGINE
   ┌─────────────┐
   │ Filter      │ ──▶ Liquidatable positions
   │ Calculate   │ ──▶ Profit estimates
   │ Select      │ ──▶ Best opportunities
   └─────────────┘
                     │
                     ▼
4. EXECUTOR
   ┌─────────────┐
   │ Build       │ ──▶ Transaction data
   │ Simulate    │ ──▶ Verify success
   │ Submit      │ ──▶ Send to network
   └─────────────┘
                     │
                     ▼
5. MONITORING
   ┌─────────────┐
   │ Verify      │ ──▶ Confirmed on-chain
   │ Log         │ ──▶ Record profit/loss
   │ Alert       │ ──▶ Notify of issues
   └─────────────┘
```

---

## 5. Supported Protocols (Initial)

| Protocol | Network | Liquidation Function | Bonus Rate |
|----------|---------|----------------------|-------------|
| Aave V3 | Ethereum, Arbitrum, Polygon | `liquidationCall()` | 5-15% |
| Compound V3 | Ethereum, Arbitrum | `liquidate()` | 5-10% |
| Radiant V3 | Arbitrum | `liquidate()` | 5-8% |

---

## 6. Risk Analysis

| Risk | Mitigation |
|------|------------|
| **Gas wars** - Other bots compete | Use Flashbots MEV boost, set competitive gas |
| **Slippage** - Price moves during execution | Set slippage protection, use TWAP prices |
| **Oracle failure** - Stale prices | Use multiple price sources, circuit breakers |
| **Liquidation reverts** - Position already handled | Handle gracefully, skip and log |
| **Smart contract bugs** | Research audits, start with small positions |
| **Insufficient capital** - Can't complete liquidation | Monitor capital, prioritize by capital efficiency |

---

## 7. Infrastructure Requirements

### Minimum Viable:
- [ ] Cloud server (AWS/GCP/DigitalOcean)
- [ ] RPC endpoint (Alchemy/Infura paid plan)
- [ ] Wallet with gas + debt tokens
- [ ] Basic monitoring (logs, alerts)

### Production Ready:
- [ ] Multi-region deployment for lower latency
- [ ] Dedicated RPC endpoints per chain
- [ ] Flashbots/MEV-boost integration
- [ ] Discord/Slack alerts for failures
- [ ] Dashboard for profit tracking
- [ ] Automated capital rebalancing

---

## 8. Development Phases

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Set up RPC connections to 2-3 chains
- [ ] Connect to Aave V3 subgraph
- [ ] Build position health monitor
- [ ] Basic price feed integration

### Phase 2: Strategy Engine (Week 2-3)
- [ ] Profit calculation logic
- [ ] Position filtering/selection
- [ ] Gas estimation
- [ ] Backtesting with historical data

### Phase 3: Executor (Week 3-4)
- [ ] Transaction builder for Aave
- [ ] Simulation + submission
- [ ] Basic error handling

### Phase 4: Production (Week 4+)
- [ ] Add more protocols (Compound, Radiant)
- [ ] Multi-chain support
- [ ] Monitoring + alerts
- [ ] Capital management

---

## 9. Key Decisions to Make

1. **Which chain to start?** → Recommend Arbitrum (good liquidity, less competition than Ethereum)

2. **Capital requirements?** → Minimum ~$5k for gas + positions, optimal ~$20k+

3. **Start with which protocol?** → Aave V3 (most liquidations, good documentation)

4. **Build vs buy?** → Build for learning, consider buying data feeds later

---

## 10. Next Steps

1. **Research** → Study Aave V3 liquidation mechanics in detail
2. **Setup** → Create repo with initial structure
3. **Data** → Connect to Aave subgraph, extract positions
4. **Test** → Run simulation on testnet/mainnet fork

---

*Document version: 1.0*
*Last updated: 2026-03-27*