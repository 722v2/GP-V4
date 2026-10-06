import { z } from "zod";
import type { Direction } from "./Setup.js";

export const RISK_VERDICTS = ["APPROVED", "REJECTED", "DEGRADED"] as const;
export type RiskVerdict = (typeof RISK_VERDICTS)[number];

/**
 * Output of the Risk Engine boundary. The pipeline MUST NOT construct a
 * TradePlan without an APPROVED RiskDecision. Lot size is always computed
 * here, never by AI.
 */
export interface RiskDecision {
  readonly verdict: RiskVerdict;
  readonly direction: Direction;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2: number;
  readonly lotSize: number;
  readonly riskAmount: number;
  readonly reasons: readonly string[];
  readonly killSwitchLevel: KillSwitchLevel;

  // Position sizing audit and debugging fields (P2-15)
  readonly equityUsed?: number;
  readonly riskPercent?: number;
  readonly riskBudgetUsd?: number;
  readonly stopDistance?: number;
  readonly spreadCostUsd?: number;
  readonly rawLotSize?: number;
  readonly maxLot?: number;
}

export const KILL_SWITCH_LEVELS = ["NONE", "L1", "L2", "L3"] as const;
export type KillSwitchLevel = (typeof KILL_SWITCH_LEVELS)[number];

export const KILL_SWITCH_SCHEMA = z.object({
  level: z.enum(KILL_SWITCH_LEVELS),
  reason: z.string(),
  updatedAt: z.number(),
  updatedBy: z.string(),
  active: z.boolean(),
});

/**
 * Breach evaluations that can escalate the kill switch:
 * - L1: warning (throttled trading / alerts only)
 * - L2: halt new entries, manage existing
 * - L3: full halt, flatten consideration
 */
export interface RiskBreaches {
  readonly dailyLossExceeded: boolean;
  readonly weeklyLossExceeded: boolean;
  readonly drawdownExceeded: boolean;
  readonly maxOpenTradesExceeded: boolean;
  readonly netExposureExceeded: boolean;
  readonly marginCeilingExceeded: boolean;
}
