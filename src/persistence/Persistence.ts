import type { Setup } from "../core/types/Setup.js";
import type { Trade, TradePlan } from "../core/types/Trade.js";
import type { AiDecision, AiResult } from "../core/types/AiDecision.js";

/**
 * Persistence boundary. All persistence is behind this interface so the
 * pipeline is fully testable without a live Supabase project.
 */
export interface PersistenceRepository {
  saveSetup(setup: Setup): Promise<void>;
  saveAiDecision(setupId: string, result: AiResult, mode: string): Promise<void>;
  saveTradePlan(plan: TradePlan, decision: RiskDecisionRecord): Promise<void>;
  updateTrade(trade: Trade): Promise<void>;
  readonly name: string;
}

export interface RiskDecisionRecord {
  readonly verdict: string;
  readonly lotSize: number;
  readonly riskAmount: number;
  readonly reasons: readonly string[];
}

/** No-op repository used when persistence is disabled or not configured. */
export class NullRepository implements PersistenceRepository {
  readonly name = "null";
  async saveSetup(_setup: Setup): Promise<void> {}
  async saveAiDecision(_setupId: string, _result: AiResult, _mode: string): Promise<void> {}
  async saveTradePlan(_plan: TradePlan, _decision: RiskDecisionRecord): Promise<void> {}
  async updateTrade(_trade: Trade): Promise<void> {}
}

/** Serializes a decision row for storage — kept explicit for schema evolution. */
export function serializeAiDecision(setupId: string, result: AiResult, mode: string): Record<string, unknown> {
  return {
    setup_id: setupId,
    mode,
    ok: result.ok,
    decision: result.ok ? result.decision.decision : null,
    confidence: result.ok ? result.decision.confidence : null,
    payload: result.ok ? result.decision : result.failure,
    cost_usd: result.ok ? result.costUsd : 0,
    cached: result.ok ? result.cached : false,
  };
}
