import type { Setup } from "../core/types/Setup.js";
import type { RiskDecision } from "../core/types/Risk.js";
import type { TradePlan } from "../core/types/Trade.js";
import { calculateTradeR } from "../core/types/Trade.js";

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
  readonly timeframe?: string;
  readonly barOpenTime?: number;
}

let signalCounter = 0;

/**
  * Generates a canonical deterministic signal ID derived from stable event properties.
  * Same inputs -> same ID across process restarts, runtimes, or retries.
  */
export function generateSignalId(setup: {
  symbol: string;
  timeframe: string;
  barOpenTime: number;
  direction: string;
  strategyId?: string;
}): string {
  const strategy = setup.strategyId ?? "strong-candle";
  return `sig:${setup.symbol}:${setup.timeframe}:${setup.barOpenTime}:${setup.direction}:${strategy}`;
}

/**
 * Builds a Signal from an approved RiskDecision. A Signal is the immutable record
 * that a risk-approved opportunity existed — it precedes any TradePlan/order.
 */
export function buildSignal(setup: Setup, risk: RiskDecision, mode: string, now: number): Signal {
  signalCounter += 1;
  const signalId = generateSignalId({
    symbol: setup.symbol,
    timeframe: setup.timeframe,
    barOpenTime: setup.barOpenTime,
    direction: setup.direction,
    strategyId: setup.strategyId,
  });

  return {
    id: signalId,
    setupId: setup.id,
    symbol: setup.symbol,
    timeframe: setup.timeframe,
    barOpenTime: setup.barOpenTime,
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

export function buildTradePlan(signal: Signal, now: number, extra?: Partial<TradePlan>): TradePlan {
  const rMultiples = calculateTradeR({
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
  });

  return {
    id: `tp:${signal.id}`,
    signalId: signal.id,
    setupId: signal.setupId,
    symbol: signal.symbol as TradePlan["symbol"],
    timeframe: signal.timeframe,
    direction: signal.direction,
    entry: signal.entry,
    stopLoss: signal.stopLoss,
    takeProfit1: signal.takeProfit1,
    takeProfit2: signal.takeProfit2,
    rTp1: rMultiples.rTp1,
    rTp2: rMultiples.rTp2,
    lotSize: signal.lotSize,
    riskAmount: signal.riskAmount,
    idempotencyKey: `idem:${signal.id}`,
    mode: signal.mode,
    createdAt: now,
    ...extra,
  };
}

export function resetSignalCounter(): void {
  signalCounter = 0;
}
