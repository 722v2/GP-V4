-- Migration: Create experience_records table for persistent trading feedback and point-in-time advisory learning
-- Matches TradeExperienceRecord in src/core/memory/ExperienceMemory.ts

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
