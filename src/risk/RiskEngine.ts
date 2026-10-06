import type { Direction, Setup } from "../core/types/Setup.js";
import type { RiskDecision, RiskBreaches, KillSwitchLevel, RiskVerdict } from "../core/types/Risk.js";
import { KILL_SWITCH_LEVELS } from "../core/types/Risk.js";
import type { InstrumentSpec } from "./InstrumentSpec.js";
import { DEFAULT_XAUUSD_SPEC } from "./InstrumentSpec.js";

export interface RiskConfig {
  perTradePct: number;
  minRiskPerTradePct?: number;
  maxRiskPerTradePct?: number;
  dailyLossCapPct: number;
  weeklyLossCapPct: number;
  maxDrawdownPct: number;
  maxOpenTrades: number;
  netExposureMax: number;
  marginCeilingPct: number;
  accountEquity: number;
  minStopDistancePts?: number;
  maxStopDistancePts?: number;
  maxLot?: number;
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

export interface SizingResult {
  readonly lotSize: number;
  readonly rawLotSize: number;
  readonly riskAmount: number;
  readonly riskBudgetUsd: number;
  readonly stopDistance: number;
  readonly spreadCostUsd: number;
  readonly error?: string;
}

/**
 * Single canonical position-sizing calculation boundary.
 * Accounts for account equity, risk %, stop distance, spread cost, lot step,
 * min lot, and max lot limits driven by configuration and instrument specification.
 */
export function calculatePositionSizing(
  entry: number,
  stopLoss: number,
  equity: number,
  perTradePct: number,
  spec: InstrumentSpec = DEFAULT_XAUUSD_SPEC,
  spreadPoints = 0,
  maxLotLimit = 1000.0
): SizingResult {
  if (!Number.isFinite(equity) || equity <= 0) {
    return { lotSize: 0, rawLotSize: 0, riskAmount: 0, riskBudgetUsd: 0, stopDistance: 0, spreadCostUsd: 0, error: `equity is zero or invalid (${equity})` };
  }
  if (!Number.isFinite(perTradePct) || perTradePct <= 0) {
    return { lotSize: 0, rawLotSize: 0, riskAmount: 0, riskBudgetUsd: 0, stopDistance: 0, spreadCostUsd: 0, error: `invalid risk per trade percentage (${perTradePct})` };
  }
  if (!spec || !Number.isFinite(spec.contractSize) || spec.contractSize <= 0 || !Number.isFinite(spec.lotStep) || spec.lotStep <= 0) {
    return { lotSize: 0, rawLotSize: 0, riskAmount: 0, riskBudgetUsd: 0, stopDistance: 0, spreadCostUsd: 0, error: "invalid instrument specification" };
  }
  if (!Number.isFinite(spreadPoints) || spreadPoints < 0) {
    return { lotSize: 0, rawLotSize: 0, riskAmount: 0, riskBudgetUsd: 0, stopDistance: 0, spreadCostUsd: 0, error: `spread points invalid or unavailable (${spreadPoints})` };
  }

  const stopDistance = Math.abs(entry - stopLoss);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
    return { lotSize: 0, rawLotSize: 0, riskAmount: 0, riskBudgetUsd: 0, stopDistance: 0, spreadCostUsd: 0, error: `invalid stop distance (${stopDistance})` };
  }

  const totalRiskPriceDistance = stopDistance + spreadPoints;
  const riskPerLot = totalRiskPriceDistance * spec.contractSize;
  const riskBudgetUsd = (equity * perTradePct) / 100;

  if (riskPerLot <= 0 || !Number.isFinite(riskPerLot)) {
    return { lotSize: 0, rawLotSize: 0, riskAmount: 0, riskBudgetUsd, stopDistance, spreadCostUsd: 0, error: "risk per lot calculation invalid" };
  }

  const rawLotSize = riskBudgetUsd / riskPerLot;
  if (!Number.isFinite(rawLotSize) || rawLotSize <= 0) {
    return { lotSize: 0, rawLotSize: 0, riskAmount: 0, riskBudgetUsd, stopDistance, spreadCostUsd: 0, error: "computed raw lot size is zero or invalid" };
  }

  // Conservative rounding to lot step (flooring ensures risk budget is never exceeded)
  const lotStep = spec.lotStep;
  let roundedLots = Math.floor(rawLotSize / lotStep) * lotStep;
  roundedLots = Math.round(roundedLots * 100000) / 100000;

  if (roundedLots < spec.minLot) {
    return {
      lotSize: 0,
      rawLotSize,
      riskAmount: 0,
      riskBudgetUsd,
      stopDistance,
      spreadCostUsd: spreadPoints * spec.contractSize * rawLotSize,
      error: `computed lot size (${roundedLots.toFixed(2)}) below min lot (${spec.minLot})`,
    };
  }

  const effectiveMaxLot = Math.min(spec.maxLot, maxLotLimit);
  if (roundedLots > effectiveMaxLot) {
    return {
      lotSize: 0,
      rawLotSize,
      riskAmount: 0,
      riskBudgetUsd,
      stopDistance,
      spreadCostUsd: spreadPoints * spec.contractSize * rawLotSize,
      error: `computed lot size (${roundedLots.toFixed(2)}) exceeds max lot limit (${effectiveMaxLot})`,
    };
  }

  const spreadCostUsd = spreadPoints * spec.contractSize * roundedLots;
  const riskAmount = totalRiskPriceDistance * spec.contractSize * roundedLots;

  return {
    lotSize: roundedLots,
    rawLotSize,
    riskAmount,
    riskBudgetUsd,
    stopDistance,
    spreadCostUsd,
  };
}

/**
 * Calculates lot size for backward compatibility, returning the final lot size number.
 */
export function computeLotSize(
  entry: number,
  stopLoss: number,
  equity: number,
  perTradePct: number,
  spec: InstrumentSpec = DEFAULT_XAUUSD_SPEC,
  spreadPoints = 0,
  maxLotLimit = 1000.0
): number {
  return calculatePositionSizing(entry, stopLoss, equity, perTradePct, spec, spreadPoints, maxLotLimit).lotSize;
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
 * REJECTED verdict with reasons instead. Central owner of trade risk approval.
 */
export function evaluateRisk(
  cfg: RiskConfig,
  env: RiskEnvironment,
  setup: Setup,
  direction: Direction,
  mode?: string,
  spec: InstrumentSpec = DEFAULT_XAUUSD_SPEC,
  spreadPoints = 0
): RiskDecision {
  const reasons: string[] = [];

  // 1. Environmental & Breach Checks
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

  // 2. Equity & Risk % Validation
  const equity = env.equity;
  if (!Number.isFinite(equity) || equity <= 0) {
    reasons.push(`equity is zero or invalid (${equity})`);
  }

  const minRiskPct = cfg.minRiskPerTradePct ?? 0.0001;
  const maxRiskPct = cfg.maxRiskPerTradePct ?? 100.0;
  if (!Number.isFinite(cfg.perTradePct) || cfg.perTradePct < minRiskPct || cfg.perTradePct > maxRiskPct) {
    reasons.push(`risk per trade (${cfg.perTradePct}%) outside allowed bounds [${minRiskPct}%, ${maxRiskPct}%]`);
  }

  // 3. Directional Stop Loss Sanity
  if (setup.stopLoss >= setup.entry && direction === "LONG") {
    reasons.push("stop loss is not below entry for LONG");
  }
  if (setup.stopLoss <= setup.entry && direction === "SHORT") {
    reasons.push("stop loss is not above entry for SHORT");
  }

  // 4. Stop Distance Min / Max Bounds
  const stopDistance = Math.abs(setup.entry - setup.stopLoss);
  const minStopPts = cfg.minStopDistancePts ?? 0.01;
  const maxStopPts = cfg.maxStopDistancePts ?? 1000.0;

  if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
    reasons.push(`invalid stop distance: ${stopDistance}`);
  } else if (stopDistance < minStopPts) {
    reasons.push(`stop distance (${stopDistance.toFixed(2)} pts) below minimum allowed (${minStopPts.toFixed(2)} pts)`);
  } else if (stopDistance > maxStopPts) {
    reasons.push(`stop distance (${stopDistance.toFixed(2)} pts) above maximum allowed (${maxStopPts.toFixed(2)} pts)`);
  }

  // 5. Position Sizing Calculation
  const maxLotLimit = cfg.maxLot ?? 1000.0;
  const sizing = calculatePositionSizing(
    setup.entry,
    setup.stopLoss,
    equity,
    cfg.perTradePct,
    spec,
    spreadPoints,
    maxLotLimit
  );

  if (sizing.error) {
    reasons.push(sizing.error);
  }

  const verdict: RiskVerdict = reasons.length === 0 ? "APPROVED" : "REJECTED";

  return {
    verdict,
    direction,
    entry: setup.entry,
    stopLoss: setup.stopLoss,
    takeProfit1: setup.takeProfit1,
    takeProfit2: setup.takeProfit2,
    lotSize: sizing.lotSize,
    riskAmount: sizing.riskAmount,
    reasons,
    killSwitchLevel,
    equityUsed: equity,
    riskPercent: cfg.perTradePct,
    riskBudgetUsd: sizing.riskBudgetUsd,
    stopDistance: sizing.stopDistance,
    spreadCostUsd: sizing.spreadCostUsd,
    rawLotSize: sizing.rawLotSize,
    maxLot: maxLotLimit,
  };
}

function levelRank(l: KillSwitchLevel): number {
  return KILL_SWITCH_LEVELS.indexOf(l);
}
