-- ============================================================================
-- GP-V4 COMPLETE CONSOLIDATED SUPABASE DATABASE SCHEMA
-- Target: Supabase Cloud / PostgreSQL
-- Purpose: Complete, clean, idempotent database schema for GP-V4 enterprise deployment
-- Safe to execute against a brand-new empty Supabase project or existing instance
-- ============================================================================

-- Enable required PostgreSQL extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- DOMAIN 1: SYSTEM SETTINGS (singleton runtime configuration & operational state)
-- Code files: src/persistence/SupabaseRepository.ts, src/config/RuntimeConfigStore.ts, src/scanner/ScannerActivity.ts, src/execution/broker/Mt5Service.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  settings JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by TEXT NOT NULL
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_system_settings" ON system_settings;
CREATE POLICY "service_role_all_system_settings" ON system_settings
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 2: KILL SWITCH (emergency shutdown & risk level persistence)
-- Code files: src/risk/KillSwitch.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS kill_switch (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  level TEXT NOT NULL CHECK (level IN ('NONE', 'L1', 'L2', 'L3')),
  reason TEXT,
  updated_at BIGINT,
  updated_by TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE kill_switch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_kill_switch" ON kill_switch;
CREATE POLICY "service_role_all_kill_switch" ON kill_switch
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 3: SIGNALS (deterministic market signal origination & idempotency)
-- Code files: src/pipeline/Signal.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  setup_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT 'M5',
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  bar_open_time BIGINT,
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit1 NUMERIC NOT NULL,
  take_profit2 NUMERIC NOT NULL,
  lot_size NUMERIC NOT NULL,
  risk_amount NUMERIC NOT NULL,
  mode TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_id ON signals (id);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_tf_time ON signals (symbol, timeframe, bar_open_time);
CREATE INDEX IF NOT EXISTS idx_signals_setup_id ON signals (setup_id);

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_signals" ON signals;
CREATE POLICY "service_role_all_signals" ON signals
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 4: SETUPS (confluence strategy setup structures)
-- Code files: src/core/types/Setup.ts, src/strategies/SetupStore.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS setups (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  bar_open_time BIGINT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('NEW', 'ACTIVE', 'UPDATED', 'INVALIDATED', 'TRIGGERED', 'EXPIRED')),
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit1 NUMERIC NOT NULL,
  take_profit2 NUMERIC NOT NULL,
  rationale TEXT,
  evidence JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_setups_state ON setups (state);
CREATE INDEX IF NOT EXISTS idx_setups_symbol_tf ON setups (symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_setups_created_at ON setups (created_at);

ALTER TABLE setups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_setups" ON setups;
CREATE POLICY "service_role_all_setups" ON setups
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 5: AI DECISIONS (AI evaluation & advisory decision records)
-- Code files: src/core/types/AiDecision.ts, src/ai/AiRouter.ts, src/persistence/SupabaseRepository.ts, src/persistence/Persistence.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_decisions (
  setup_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  decision TEXT CHECK (decision IS NULL OR decision IN ('TRADE_CANDIDATE', 'NO_TRADE', 'WATCH', 'REASSESS', 'BLOCKED_BY_POLICY')),
  direction TEXT CHECK (direction IS NULL OR direction IN ('LONG', 'SHORT')),
  confidence NUMERIC,
  rationale TEXT,
  evidence JSONB,
  risk_notes JSONB,
  reason_codes JSONB,
  reassessment_conditions JSONB,
  model TEXT,
  payload JSONB,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  cached BOOLEAN NOT NULL DEFAULT FALSE,
  decided_at BIGINT NOT NULL
);

-- Idempotent column & constraint adjustments for legacy schema migration alignment
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS ok BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS cost_usd NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS cached BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_decisions ALTER COLUMN decision DROP NOT NULL;

ALTER TABLE ai_decisions DROP CONSTRAINT IF EXISTS ai_decisions_decision_check;
ALTER TABLE ai_decisions ADD CONSTRAINT ai_decisions_decision_check CHECK (
  decision IS NULL OR decision IN ('TRADE_CANDIDATE', 'NO_TRADE', 'WATCH', 'REASSESS', 'BLOCKED_BY_POLICY')
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_decided_at ON ai_decisions (decided_at);

ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_ai_decisions" ON ai_decisions;
CREATE POLICY "service_role_all_ai_decisions" ON ai_decisions
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 6: TRADES (trade lifecycle, positions, & PnL realization)
-- Code files: src/core/types/Trade.ts, src/execution/TradeLifecycle.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  signal_id TEXT,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  state TEXT NOT NULL CHECK (state IN ('PLANNED', 'PENDING_CONFIRMATION', 'SUBMITTED', 'OPEN', 'TP1_HIT', 'TP2_HIT', 'SL_HIT', 'MANUALLY_CLOSED', 'REJECTED', 'EXPIRED')),
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit1 NUMERIC NOT NULL,
  take_profit2 NUMERIC NOT NULL,
  lot_size NUMERIC NOT NULL,
  risk_amount NUMERIC NOT NULL,
  mode TEXT NOT NULL,
  opened_at BIGINT,
  closed_at BIGINT,
  realized_pnl NUMERIC,
  exit_reason TEXT,
  risk_decision JSONB,
  created_at BIGINT NOT NULL
);

-- Idempotent constraint adjustment for complete TradeState enum alignment
ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_state_check;
ALTER TABLE trades ADD CONSTRAINT trades_state_check CHECK (
  state IN (
    'PLANNED',
    'PENDING_CONFIRMATION',
    'SUBMITTED',
    'OPEN',
    'TP1_HIT',
    'TP2_HIT',
    'SL_HIT',
    'MANUALLY_CLOSED',
    'REJECTED',
    'EXPIRED'
  )
);

CREATE INDEX IF NOT EXISTS idx_trades_state ON trades (state);
CREATE INDEX IF NOT EXISTS idx_trades_symbol_direction ON trades (symbol, direction);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades (closed_at);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_trades" ON trades;
CREATE POLICY "service_role_all_trades" ON trades
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 7: ORDERS (broker order submissions & restart-safe idempotency)
-- Code files: src/execution/ExecutionEngine.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  trade_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  order_type TEXT NOT NULL CHECK (order_type IN ('MARKET', 'LIMIT', 'STOP')),
  requested_lot NUMERIC NOT NULL,
  filled_lot NUMERIC NOT NULL DEFAULT 0,
  requested_price NUMERIC,
  fill_price NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  status TEXT NOT NULL CHECK (status IN ('ORDER_PENDING', 'ORDER_SUBMITTED', 'ORDER_PARTIALLY_FILLED', 'ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'ORDER_UNKNOWN')),
  rejection_reason TEXT,
  submitted_at BIGINT NOT NULL,
  filled_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_orders_trade_id ON orders (trade_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_orders" ON orders;
CREATE POLICY "service_role_all_orders" ON orders
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 8: EXECUTIONS (broker fills, slippage, & commission audit log)
-- Code files: src/execution/ExecutionEngine.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  filled_lot NUMERIC NOT NULL,
  fill_price NUMERIC NOT NULL,
  slippage_points NUMERIC NOT NULL DEFAULT 0,
  commission NUMERIC NOT NULL DEFAULT 0,
  protection_status TEXT NOT NULL CHECK (protection_status IN ('PROTECTED', 'PARTIALLY_PROTECTED', 'UNPROTECTED', 'UNKNOWN')),
  executed_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executions_trade_id ON executions (trade_id);
CREATE INDEX IF NOT EXISTS idx_executions_executed_at ON executions (executed_at);

ALTER TABLE executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_executions" ON executions;
CREATE POLICY "service_role_all_executions" ON executions
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 9: RECONCILIATION EVENTS (startup & periodic reconciliation audit log)
-- Code files: src/safety/Reconciliation.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS reconciliation_events (
  id TEXT PRIMARY KEY,
  mismatches_count INTEGER NOT NULL,
  mismatches JSONB NOT NULL,
  kill_switch_level TEXT NOT NULL,
  repairs_attempted INTEGER NOT NULL DEFAULT 0,
  repaired_count INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_events_created_at ON reconciliation_events (created_at);

ALTER TABLE reconciliation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_reconciliation_events" ON reconciliation_events;
CREATE POLICY "service_role_all_reconciliation_events" ON reconciliation_events
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 10: PROMOTION GATES (evaluation reports & auto-trading eligibility history)
-- Code files: src/safety/PromotionGates.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS promotion_gates (
  id TEXT PRIMARY KEY,
  overall_state TEXT NOT NULL,
  auto_trading_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  active_mode TEXT NOT NULL,
  gates JSONB NOT NULL,
  summary TEXT NOT NULL,
  evaluated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_promotion_gates_evaluated_at ON promotion_gates (evaluated_at);

ALTER TABLE promotion_gates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_promotion_gates" ON promotion_gates;
CREATE POLICY "service_role_all_promotion_gates" ON promotion_gates
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- DOMAIN 11: EXPERIENCE RECORDS (factor combinations & trade outcome memory)
-- Code files: src/core/memory/ExperienceMemory.ts, src/persistence/SupabaseRepository.ts
-- ============================================================================

CREATE TABLE IF NOT EXISTS experience_records (
  id TEXT PRIMARY KEY,
  setup_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  opened_at BIGINT NOT NULL,
  closed_at BIGINT NOT NULL,
  factors JSONB NOT NULL,
  confluence_score NUMERIC NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('WIN', 'LOSS', 'EVEN')),
  realized_r NUMERIC NOT NULL,
  realized_pnl NUMERIC NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experience_records_closed_at ON experience_records (closed_at);
CREATE INDEX IF NOT EXISTS idx_experience_records_symbol_tf ON experience_records (symbol, timeframe);

ALTER TABLE experience_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_experience_records" ON experience_records;
CREATE POLICY "service_role_all_experience_records" ON experience_records
  FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- VERIFICATION SECTION
-- Execute to verify all 11 required GP-V4 persistence tables exist with RLS enabled
-- ============================================================================

SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN (
    'system_settings',
    'kill_switch',
    'signals',
    'setups',
    'ai_decisions',
    'trades',
    'orders',
    'executions',
    'reconciliation_events',
    'promotion_gates',
    'experience_records'
  )
ORDER BY table_name;
