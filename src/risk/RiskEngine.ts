import type { Direction, Setup } from "../core/types/Setup.js";
import type { RiskDecision, RiskBreaches, KillSwitchLevel, RiskVerdict } from "../core/types/Risk.js";
import { KILL_SWITCH_LEVELS } from "../core/types/Risk.js";

export interface RiskConfig {
  perTradePct: number;
  dailyLossCapPct: number;
  weeklyLossCapPct: number;
  maxDrawdownPct: number;
  maxOpenTrades: number;
  netExposureMax: number;
  marginCeilingPct: number;
  accountEquity: number;
}

export interface RiskState {
  readonly openTrades: number;
  readonly netExposureLots: number;
  readonly marginUsedPct: number;
  readonly dailyLossPct: number;
  readonly weeklyLossPct: number;
  readonly maxDrawdownPct: number;
}

export const DEFAULT_RISK_STATE: RiskState = {
  openTrades: 0,
  netExposureLots: 0,
  marginUsedPct: 0,
  dailyLossPct: 0,
  weeklyLossPct: 0,
  maxDrawdownPct: 0,
};

export interface RiskEnvironment {
  readonly equity: number;
  readonly state: RiskState;
  readonly killSwitch: KillSwitchLevel;
  readonly mode?: string;
}

/**
 * Risk engine boundary: the ONLY place lot sizes and approval verdicts are
 * computed. AI never supplies lot size or risk amount.
 *
 * For XAUUSD, one standard lot (100 oz) moves $1 of price = $100 P&L per price
 * unit. Risk per lot = stop distance (price units) × 100. Lot size is scaled so
 * riskAmount ≈ equity × perTradePct / 100, clamped by per-trade equity share.
 */
export function computeLotSize(entry: number, stopLoss: number, equity: number, perTradePct: number): number {
  const stopDistance = Math.abs(entry - stopLoss);
  if (stopDistance <= 0) return 0;
  const riskBudgetUsd = (equity * perTradePct) / 100;
  const riskPerLot = stopDistance * 100;
  const lots = riskBudgetUsd / riskPerLot;
  return roundLots(lots);
}

/** Round to broker-standard 0.01-lot steps, floor to stay under budget. */
function roundLots(lots: number): number {
  if (!Number.isFinite(lots) || lots <= 0) return 0;
  return Math.floor(lots * 100) / 100;
}

/** Maps breached caps to a kill-switch level: none / L1 warning / L2 halt entries / L3 full halt. */
export function evaluateBreaches(cfg: RiskConfig, state: RiskState): RiskBreaches {
  return {
    dailyLossExceeded: state.dailyLossPct >= cfg.dailyLossCapPct,
    weeklyLossExceeded: state.weeklyLossPct >= cfg.weeklyLossCapPct,
    drawdownExceeded: state.maxDrawdownPct >= cfg.maxDrawdownPct,
    maxOpenTradesExceeded: state.openTrades >= cfg.maxOpenTrades,
    netExposureExceeded: state.netExposureLots >= cfg.netExposureMax,
    marginCeilingExceeded: state.marginUsedPct >= cfg.marginCeilingPct,
  };
}

export function breachLevel(breaches: RiskBreaches): KillSwitchLevel {
  if (breaches.dailyLossExceeded || breaches.weeklyLossExceeded || breaches.drawdownExceeded) return "L3";
  if (breaches.maxOpenTradesExceeded || breaches.netExposureExceeded || breaches.marginCeilingExceeded) return "L2";
  return "NONE";
}

/** Trivial tally of remaining trade capacity: -1 unlimited, or count of open slots. */
export function openSlots(cfg: RiskConfig, state: RiskState): number | "unlimited" {
  if (!Number.isFinite(cfg.maxOpenTrades)) return "unlimited";
  return Math.max(0, cfg.maxOpenTrades - state.openTrades);
}

/**
 * Evaluates a proposed Setup into a RiskDecision. Never throws; returns a typed
 * REJECTED verdict with reasons instead.
 */
export function evaluateRisk(
  cfg: RiskConfig,
  env: RiskEnvironment,
  setup: Setup,
  direction: Direction,
  mode?: string
): RiskDecision {
  const reasons: string[] = [];
  const breaches = evaluateBreaches(cfg, env.state);
  const envLevel = breachLevel(breaches);
  let killSwitchLevel: KillSwitchLevel = env.killSwitch;
  if (levelRank(envLevel) > levelRank(killSwitchLevel)) killSwitchLevel = envLevel;

  const effectiveMode = mode ?? env.mode;

  if (killSwitchLevel === "L3") {
    reasons.push("kill switch L3 active — full halt");
  } else if (killSwitchLevel === "L2") {
    if (effectiveMode !== "ANALYSIS_ONLY") {
      reasons.push("kill switch L2 active — new entries halted");
    }
  }

  if (breaches.maxOpenTradesExceeded) reasons.push(`max open trades ${env.state.openTrades}/${cfg.maxOpenTrades}`);
  if (breaches.netExposureExceeded) reasons.push(`net exposure ${env.state.netExposureLots.toFixed(2)}/${cfg.netExposureMax}`);
  if (breaches.marginCeilingExceeded) reasons.push(`margin ceiling ${env.state.marginUsedPct.toFixed(1)}%/${cfg.marginCeilingPct}%`);

  const entry = setup.entry;
  const stopLoss = setup.stopLoss;
  const lotSize = computeLotSize(entry, stopLoss, env.equity, cfg.perTradePct);
  const riskAmount = Math.abs(entry - stopLoss) * 100 * lotSize;

  if (lotSize <= 0) reasons.push("computed lot size is zero — stop too wide or equity too low");
  if (setup.stopLoss >= setup.entry && direction === "LONG") reasons.push("stop loss is not below entry for LONG");
  if (setup.stopLoss <= setup.entry && direction === "SHORT") reasons.push("stop loss is not above entry for SHORT");

  let verdict: RiskVerdict = reasons.length === 0 ? "APPROVED" : "REJECTED";
  // L2 allows managing existing positions but blocks new entries (all proposals rejected).
  return {
    verdict,
    direction,
    entry,
    stopLoss,
    takeProfit1: setup.takeProfit1,
    takeProfit2: setup.takeProfit2,
    lotSize,
    riskAmount,
    reasons,
    killSwitchLevel,
  };
}

function levelRank(l: KillSwitchLevel): number {
  return KILL_SWITCH_LEVELS.indexOf(l);
}
