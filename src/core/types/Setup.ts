import type { Symbol, Timeframe } from "./MarketTypes.js";

export const SETUP_STATES = [
  "NEW",
  "ACTIVE",
  "UPDATED",
  "TRIGGERED",
  "EXPIRED",
  "INVALIDATED",
  "CLOSED",
] as const;
export type SetupState = (typeof SETUP_STATES)[number];

/**
 * A strategy-produced analytical observation with lifecycle. Immutable per
 * observation; state transitions are recorded by the setup store.
 */
export interface Setup {
  readonly id: string;
  readonly strategyId: string;
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  readonly direction: Direction;
  /** Bar close that produced this setup (idempotency anchor). */
  readonly barOpenTime: number;
  readonly createdAt: number;
  readonly state: SetupState;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2: number;
  readonly invalidationPrice: number;
  readonly rationale: string;
  readonly evidence: readonly Evidence[];
}

export const DIRECTIONS = ["LONG", "SHORT"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface Evidence {
  /** Source engine, e.g. "structure", "liquidity", "price-action", "macd". */
  readonly source: string;
  readonly kind: string;
  readonly detail: string;
  /** -1..1 — sign aligned with proposed direction, magnitude = strength. */
  readonly weight: number;
}

export function evidenceScore(evidence: readonly Evidence[], direction: Direction): number {
  const sign = direction === "LONG" ? 1 : -1;
  let total = 0;
  for (const e of evidence) {
    total += e.weight * sign;
  }
  return total;
}
