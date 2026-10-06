import type { Symbol } from "./MarketTypes.js";
import type { Direction } from "./Setup.js";

export const TRADE_STATES = [
  "PLANNED",
  "PENDING_CONFIRMATION",
  "SUBMITTED",
  "OPEN",
  "TP1_HIT",
  "TP2_HIT",
  "SL_HIT",
  "MANUALLY_CLOSED",
  "REJECTED",
  "EXPIRED",
] as const;
export type TradeState = (typeof TRADE_STATES)[number];

export interface TradePlan {
  readonly id: string;
  readonly signalId: string;
  readonly setupId?: string;
  readonly strategyId?: string;
  readonly symbol: Symbol;
  readonly timeframe?: string;
  readonly direction: Direction;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2: number;
  readonly rTp1?: number | null;
  readonly rTp2?: number | null;
  readonly lotSize: number;
  /** Computed by risk engine, never by AI. */
  readonly riskAmount: number;
  readonly riskPercent?: number;
  readonly spreadAssumptions?: number;
  readonly slippageAssumptions?: number;
  readonly aiDecision?: string;
  readonly confidence?: number;
  readonly confluenceScore?: number;
  readonly riskVerdict?: string;
  readonly idempotencyKey?: string;
  readonly mode: string;
  readonly createdAt: number;
}

export interface Trade extends TradePlan {
  readonly state: TradeState;
  readonly openedAt?: number;
  readonly closedAt?: number;
  readonly realizedPnl?: number;
  readonly exitReason?: string;
}

/**
 * Canonical R-multiple calculation:
 *   riskDistance = |entry - stopLoss|
 *   rewardDistance = |takeProfit - entry|
 *   R = rewardDistance / riskDistance
 *
 * Protects against zero/invalid risk distance:
 * If entry === stopLoss or riskDistance <= 0 (or values are non-finite),
 * returns null to prevent Infinity/NaN.
 *
 * Direction-agnostic: works identically for LONG and SHORT.
 */
export function calculateR(
  entry: number,
  stopLoss: number,
  takeProfit: number
): number | null {
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(takeProfit)
  ) {
    return null;
  }
  const riskDistance = Math.abs(entry - stopLoss);
  if (riskDistance <= 0) {
    return null;
  }
  const rewardDistance = Math.abs(takeProfit - entry);
  return rewardDistance / riskDistance;
}

export interface TradeRMultiples {
  readonly rTp1: number | null;
  readonly rTp2: number | null;
}

/**
 * Calculates canonical R-multiples for a trade plan or setup targets:
 *   R_TP1 = |takeProfit1 - entry| / |entry - stopLoss|
 *   R_TP2 = |takeProfit2 - entry| / |entry - stopLoss|
 */
export function calculateTradeR(trade: {
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
}): TradeRMultiples {
  return {
    rTp1: calculateR(trade.entry, trade.stopLoss, trade.takeProfit1),
    rTp2:
      trade.takeProfit2 !== undefined
        ? calculateR(trade.entry, trade.stopLoss, trade.takeProfit2)
        : null,
  };
}
