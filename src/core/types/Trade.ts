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
  readonly symbol: Symbol;
  readonly direction: Direction;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2: number;
  readonly lotSize: number;
  /** Computed by risk engine, never by AI. */
  readonly riskAmount: number;
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
