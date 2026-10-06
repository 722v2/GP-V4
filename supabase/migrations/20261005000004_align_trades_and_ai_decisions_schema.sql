-- Migration: Align trades.state check constraint and ai_decisions schema with TypeScript domain contracts
-- Matches TradeState in src/core/types/Trade.ts and serializeAiDecision in src/persistence/Persistence.ts

-- 1. Update trades.state CHECK constraint to include all valid TradeState values
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

-- 2. Align ai_decisions schema with serializeAiDecision payload and make decision nullable for failed AI calls
-- Add missing serialization columns
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS ok BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS cost_usd NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE ai_decisions ADD COLUMN IF NOT EXISTS cached BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow decision to be NULL when ok is false (AI provider error, timeout, circuit breaker)
ALTER TABLE ai_decisions ALTER COLUMN decision DROP NOT NULL;

-- Update decision check constraint to permit NULL or valid decision kinds
ALTER TABLE ai_decisions DROP CONSTRAINT IF EXISTS ai_decisions_decision_check;
ALTER TABLE ai_decisions ADD CONSTRAINT ai_decisions_decision_check CHECK (
  decision IS NULL OR decision IN ('TRADE_CANDIDATE', 'NO_TRADE', 'WATCH', 'REASSESS', 'BLOCKED_BY_POLICY')
);

-- Ensure Row Level Security remains enabled
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;
