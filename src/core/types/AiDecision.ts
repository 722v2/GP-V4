import { z } from "zod";

export const AI_DECISIONS = ["NO_TRADE", "WATCH", "TRADE_CANDIDATE"] as const;
export type AiDecisionKind = (typeof AI_DECISIONS)[number];

/**
 * The validated structured decision the AI provider must return.
 * Confidence is an AI self-assessment in [0,1] — explicitly NOT win probability.
 */
export const AiDecisionSchema = z.object({
  decision: z.enum(AI_DECISIONS),
  direction: z.enum(["LONG", "SHORT"]).optional(),
  setup_id: z.string().optional(),
  entry: z.number().positive().optional(),
  SL: z.number().positive().optional(),
  TP1: z.number().positive().optional(),
  TP2: z.number().positive().optional(),
  invalidation: z.number().positive().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(
    z.object({
      source: z.string(),
      detail: z.string(),
    })
  ),
  risk_notes: z.array(z.string()),
  management_plan: z.string().optional(),
  reassessment_conditions: z.array(z.string()),
  reason_codes: z.array(z.string()),
});
export type AiDecision = z.infer<typeof AiDecisionSchema>;

/** Degraded result used when AI fails, times out, is budget-blocked, or returns invalid output. */
export interface AiFailure {
  readonly kind:
    | "TIMEOUT"
    | "INVALID_OUTPUT"
    | "PROVIDER_ERROR"
    | "BUDGET_EXCEEDED"
    | "CIRCUIT_OPEN"
    | "RETRIES_EXHAUSTED";
  readonly message: string;
  readonly attempt?: number;
}

export type AiResult =
  | { readonly ok: true; readonly decision: AiDecision; readonly cached: boolean; readonly costUsd: number; readonly tokens: { prompt: number; completion: number } }
  | { readonly ok: false; readonly failure: AiFailure };

export interface AiUsage {
  readonly windowStart: number;
  readonly requests: number;
  readonly tokensPrompt: number;
  readonly tokensCompletion: number;
  readonly costUsd: number;
}
