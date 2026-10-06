# GP-V4 — XAU/USD Trading & Operations Platform

GP-V4 is a modular monolith for **XAU/USD strategy analysis, risk management, and operations**:
Biquiti Market Data → Analysis Engines (Structure, Liquidity, Price Action) → Confluence Engine → Strong Candle Strategy → Novita AI Router → Risk Engine Gate (Canonical R, drawdown caps, lot sizing) → Persistence & Telegram Alerts → Mode-Dependent Simulated Execution.

---

## Technical Status & Boundaries

- **Core Engine & Safety**: Foundation, confluence engines, AI routing, risk tracking, kill switch (L1/L2/L3), persistent idempotency, and reconciliation are fully implemented.
- **Operations Console**: Authoritative Arabic RTL Operations Console with SSE live streaming, dashboard, trade audits, risk monitoring, health check, settings, and verification tools.
- **Execution Boundary**: Execution is strictly **SIMULATED** (internal simulation model with spread, slippage, and latency). **Live Broker execution is NOT connected**.
- **Historical Validation**: Synthetic fixtures are used for deterministic unit and replay tests. **Real historical validation against 1–2 years of broker ticks/candles has NOT been executed** pending external broker historical data delivery.

---

## Requirements

- **Node.js**: ≥ 22.0.0
- **npm**: ≥ 10.0.0

---

## Quick Start & Commands

```bash
npm install         # Install dependencies
npm run typecheck   # Typecheck codebase (strict TypeScript, tsc --noEmit)
npm test            # Run Vitest test suite (290 tests across 25 suites)
npm run build       # Compile TypeScript project to dist/
npm run dev         # Run development server with tsx
npm start           # Run production built server (node dist/index.js)
```

---

## Architectural Data Flow

```
Closed M5 Bar → Scanner → CandleCache 
              → ConfluenceEngine (Structure + Liquidity + Price Action)
              → StrongCandleStrategy 
              → AiRouter (Novita/DeepSeek; can only downgrade/block, cannot size)
              → RiskEngine (Canonical R, Lot Sizing, Drawdown & Exposure Gates)
              → Mode Dispatch (ANALYSIS_ONLY / MANUAL_CONFIRMATION / PAPER_TRADING / SIMULATED)
              → Idempotent Persistence (Supabase / In-Memory)
              → Real-time EventBus & SSE Stream
```

### Key Invariants

1. **Closed Bars Only**: The scanner only accepts closed bars. Forward-looking or open bars are rejected.
2. **Deterministic Risk Budgeting**: Lot size and risk amount are computed strictly by `RiskEngine`. AI cannot modify lot sizes.
3. **Canonical R-Multiple**: R is computed strictly as $R = \frac{|\text{TakeProfit} - \text{Entry}|}{|\text{Entry} - \text{StopLoss}|}$.
4. **Persistent Idempotency (P2-12)**: Bar-close triggers, signal IDs, and setup IDs are deterministic and de-duplicated across restarts.
5. **Fail-Safe & Monotonic Kill Switch**: If downstream subsystems (AI, Persistence, Provider) fail, the engine degrades gracefully without originating unsafe trades.

---

## Runtime Modes (`GP_MODE`)

| Mode | Description | Execution Behavior |
| :--- | :--- | :--- |
| `ANALYSIS_ONLY` *(Default)* | Analyses and emits signals without originating orders | No order generation |
| `MANUAL_CONFIRMATION` | Generates candidate plans requiring operator confirmation | Operator review |
| `PAPER_TRADING` / `SIMULATED` | Simulated order management with spread & slippage | Simulated fills only |
| `AUTO_TRADING` | Blocked until Live Broker Adapter is integrated in Phase 3.2 | Blocked without Broker |
| `REPLAY` | Deterministic replay runner over recorded fixtures | Simulated replay clock |
| `BACKTEST` | Deterministic backtest evaluation runner | Simulated backtest |

---

## Configuration & Environment Variables

Copy `.env.example` to `.env` and configure required values:

- `GP_MODE`: Runtime mode (`ANALYSIS_ONLY`, `SIMULATED`, etc.)
- `GP_SYMBOLS`: Target symbol (e.g. `XAUUSD`)
- `GP_TIMEFRAMES`: Target timeframes (`M5`, `M15`, `H1`)
- `BIQUITI_BASE_URL` & `BIQUITI_API_KEY`: Market data REST provider credentials
- `AI_API_KEY` & `AI_MODEL`: Novita AI routing credentials (e.g. `deepseek/deepseek-r1`)
- `SUPABASE_URL` & `SUPABASE_SERVICE_KEY`: Persistent storage credentials
- `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID`: Notification channel credentials
- `RISK_ACCOUNT_EQUITY`, `RISK_PER_TRADE_PCT`, `RISK_DAILY_LOSS_CAP_PCT`: Risk engine bounds

---

## Supabase Database Migrations

SQL migration files are located in `supabase/migrations/`:
- `20261005000000_create_kill_switch.sql` — Kill switch state table with RLS.
- `20261005000001_create_signals_table.sql` — Idempotent deterministic signals table with RLS.
- `20261005000002_create_core_tables.sql` — Core operational tables (`setups`, `ai_decisions`, `trades`) with RLS.

*Note: Migrations are verified locally. Remote Supabase application requires running migrations against the live project instance.*

---

## External Integrations & Verification Status

| Integration | Implementation Status | Production Verification Status |
| :--- | :--- | :--- |
| **Biquiti Market Data** | Complete `BiquitiAdapter` | `UNVERIFIED` (Requires live API credentials & contract confirmation) |
| **Novita AI Router** | Complete `AiRouter` & `NovitaProvider` | `UNVERIFIED` (Requires live Novita API key) |
| **Supabase DB** | Complete `SupabaseRepository` & `RetryingRepository` | `UNVERIFIED` (Requires live Supabase project connection) |
| **Telegram Bot** | Complete `TelegramNotifier` | `UNVERIFIED` (Requires live bot token & chat ID) |
| **Live Broker** | Not Wired (Phase 3.2 Scope) | `NOT CONNECTED` |
| **Historical Validation**| Complete Walk-Forward Evaluator | `NOT EXECUTED` (Requires 1–2 years of broker tick data) |
| **Render Deployment** | Complete server host & port binding | `UNVERIFIED` (Requires live Render service deployment) |
