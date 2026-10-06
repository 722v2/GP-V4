-- Migration: Create kill_switch table for GP-V4 runtime state persistence
-- Matches KillSwitchState in src/core/types/Risk.ts and SupabaseRepository targets in src/persistence/SupabaseRepository.ts

CREATE TABLE IF NOT EXISTS kill_switch (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('NONE', 'L1', 'L2', 'L3')),
  reason TEXT,
  updated_at BIGINT,
  updated_by TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Enable Row Level Security (RLS) to restrict unauthorized public access.
-- The GP-V4 backend uses the Supabase service_role key, which bypasses RLS.
ALTER TABLE kill_switch ENABLE ROW LEVEL SECURITY;
