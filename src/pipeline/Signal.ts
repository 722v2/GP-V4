import type { Setup } from "../core/types/Setup.js";
import type { RiskDecision } from "../core/types/Risk.js";
import type { TradePlan } from "../core/types/Trade.js";

export interface Signal {
  readonly id: string;
  readonly setupId: string;
  readonly symbol: string;
  readonly direction: "LONG" | "SHORT";
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2: number;
  readonly lotSize: number;
  readonly riskAmount: number;
  readonly createdAt: number;
  readonly mode: string;
}

let signalCounter = 0;

/**
 * Builds a Signal from an approved RiskDecision. A Signal is the immutable record
 * that a risk-approved opportunity existed — it precedes any TradePlan/order.
 */
export function buildSignal(setup: Setup, risk: RiskDecision, mode: string, now: number): Signal {
  signalCounter += 1;
  return {
    id: `sig:${setup.symbol}:${setup.timeframe}:${setup.barOpenTime}:${signalCounter}`,
    setupId: setup.id,
    symbol: setup.symbol,
    direction: setup.direction,
    entry: risk.entry,
    stopLoss: risk.stopLoss,
    takeProfit1: risk.takeProfit1,
    takeProfit2: risk.takeProfit2,
    lotSize: risk.lotSize,
    riskAmount: risk.riskAmount,
    createdAt: now,
    mode,
  };
}

export function buildTradePlan(signal: Signal, now: number): TradePlan {
  return {
    id: `tp:${signal.id}`,
    signalId: signal.id,
    symbol: signal.symbol as TradePlan["symbol"],
    direction: signal.direction,
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    lotSize: signal.lotSize,
    riskAmount: signal.riskAmount,
    mode: signal.mode,
    createdAt: now,
  };
}

export function resetSignalCounter(): void {
  signalCounter = 0;
}