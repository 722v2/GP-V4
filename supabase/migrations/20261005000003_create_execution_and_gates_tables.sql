-- Migration: Create orders, executions, reconciliation_events, and promotion_gates tables for GP-V4
-- Matches execution boundaries, broker adapter schemas, and promotion gate state persistence

-- 1. orders table
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

-- 2. executions table
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
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;

-- 3. reconciliation_events table
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

-- 4. promotion_gates table
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

-- 5. system_settings table
CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  settings JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by TEXT NOT NULL
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
