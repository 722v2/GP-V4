import type { Setup } from "../core/types/Setup.js";
import type { RiskDecision } from "../core/types/Risk.js";
import type { AiResult } from "../core/types/AiDecision.js";

export const MODES = [
  "ANALYSIS_ONLY",
  "MANUAL_CONFIRMATION",
  "AUTO_TRADING",
  "PAPER_TRADING",
  "REPLAY",
  "BACKTEST",
] as const;
export type Mode = (typeof MODES)[number];

/** Whether a mode is allowed to originate an order at all. */
export function isExecutionMode(mode: Mode): boolean {
  return mode === "AUTO_TRADING" || mode === "PAPER_TRADING" || mode === "BACKTEST" || mode === "REPLAY";
}

/** Whether a mode needs explicit human confirmation before an order leaves. */
export function requiresConfirmation(mode: Mode): boolean {
  return mode === "MANUAL_CONFIRMATION";
}

/** Whether a mode simulates fills instead of routing to a broker. */
export function isSimulated(mode: Mode): boolean {
  return mode === "PAPER_TRADING" || mode === "BACKTEST" || mode === "REPLAY";
}

/** Whether an AI failure must block a trade in this mode (analysis alone may proceed). */
export function requiresAiGate(mode: Mode): boolean {
  return mode !== "ANALYSIS_ONLY";
}

/** Outcome of one analysis cycle for a single symbol×timeframe. */
export interface CycleOutcome {
  readonly symbol: string;
  readonly timeframe: string;
  readonly barOpenTime: number;
  readonly setup: Setup | null;
  readonly ai: AiResult | null;
  readonly risk: RiskDecision | null;
  /** What the pipeline decided to do next, given the mode. */
  readonly action: CycleAction;
  readonly reasons: readonly string[];
}

export type CycleAction =
  | { readonly kind: "NO_SETUP" }
  | { readonly kind: "AI_BLOCKED" } // AI returned NO_TRADE / WATCH or failed
  | { readonly kind: "RISK_REJECTED" }
  | { readonly kind: "CANDIDATE" } // approved, awaiting mode-specific handling
  | { readonly kind: "EXECUTED_SIMULATED"; readonly lotSize: number }
  | { readonly kind: "AWAITING_CONFIRMATION" }
  | { readonly kind: "ANALYSIS"; readonly note: string };
