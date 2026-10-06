-- Migration: Create signals table for persistent idempotency and deterministic signal IDs in GP-V4
-- Matches Signal interface in src/pipeline/Signal.ts and SupabaseRepository targets in src/persistence/SupabaseRepository.ts

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  setup_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT 'M5',
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  bar_open_time BIGINT NOT NULL,
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  take_profit1 NUMERIC NOT NULL,
  take_profit2 NUMERIC NOT NULL,
  lot_size NUMERIC NOT NULL,
  risk_amount NUMERIC NOT NULL,
  mode TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

-- Ensure deterministic signal ID uniqueness constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_id ON signals (id);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_tf_time ON signals (symbol, timeframe, bar_open_time);

-- Enable Row Level Security (RLS) to restrict unauthorized public access.
-- The GP-V4 backend uses the Supabase service_role key, which bypasses RLS.
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
