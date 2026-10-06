-- Migration: Create core operational tables (setups, ai_decisions, trades) for GP-V4
-- Matches entity schemas in src/persistence/SupabaseRepository.ts and domain types

-- 1. setups table
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
ALTER TABLE setups ENABLE ROW LEVEL SECURITY;

-- 2. ai_decisions table
CREATE TABLE IF NOT EXISTS ai_decisions (
  setup_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL CHECK (decision IN ('TRADE_CANDIDATE', 'NO_TRADE', 'REASSESS', 'BLOCKED_BY_POLICY')),
  direction TEXT,
  confidence NUMERIC,
  rationale TEXT,
  evidence JSONB,
  risk_notes JSONB,
  reason_codes JSONB,
  reassessment_conditions JSONB,
  model TEXT,
  mode TEXT NOT NULL,
  decided_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_decisions_decided_at ON ai_decisions (decided_at);
ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;

-- 3. trades table
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  signal_id TEXT,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  state TEXT NOT NULL CHECK (state IN ('PLANNED', 'SUBMITTED', 'OPEN', 'TP1_HIT', 'TP2_HIT', 'SL_HIT', 'MANUALLY_CLOSED')),
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

CREATE INDEX IF NOT EXISTS idx_trades_state ON trades (state);
CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades (closed_at);
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
