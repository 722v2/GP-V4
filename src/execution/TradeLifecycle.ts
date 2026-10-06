import type { Direction } from "../core/types/Setup.js";
import type { TradeState } from "../core/types/Trade.js";
import type { Candle } from "../core/types/Candle.js";
import type { Symbol } from "../core/types/MarketTypes.js";

/**
 * Models the spread, slippage, and latency that separate a paper/simulated fill
 * from a theoretical one. LONG entries pay up (fill above mid), SHORT entries fill below.
 */
export class SpreadSlippageModel {
  constructor(
    private spreadPoints: number,
    private slippagePoints: number,
    private latencyMs: number
  ) {}

  update(spreadPoints?: number, slippagePoints?: number, latencyMs?: number): void {
    if (spreadPoints !== undefined) this.spreadPoints = spreadPoints;
    if (slippagePoints !== undefined) this.slippagePoints = slippagePoints;
    if (latencyMs !== undefined) this.latencyMs = latencyMs;
  }

  get latency(): number {
    return this.latencyMs;
  }

  get spread(): number {
    return this.spreadPoints;
  }

  get slippage(): number {
    return this.slippagePoints;
  }

  adjustedFill(direction: Direction, price: number): number {
    const cost = this.spreadPoints + this.slippagePoints;
    return direction === "LONG" ? price + cost : price - cost;
  }

  adjustedExit(direction: Direction, price: number): number {
    const cost = this.spreadPoints + this.slippagePoints;
    return direction === "LONG" ? price - cost : price + cost;
  }
}

export interface TradeLifecycleState {
  readonly planId: string;
  readonly symbol?: Symbol | string;
  readonly direction: Direction;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit1: number;
  readonly takeProfit2: number;
  readonly lotSize: number;
  state: TradeState;
  openedAt?: number;
  closedAt?: number;
  realizedPnl?: number;
  exitReason?: string;
  tp1ClosedAt?: number;
  tp1RealizedPnl?: number;
}

export function isTerminal(state: TradeState): boolean {
  return (
    state === "TP2_HIT" ||
    state === "SL_HIT" ||
    state === "MANUALLY_CLOSED" ||
    state === "REJECTED" ||
    state === "EXPIRED"
  );
}

export function calculatePnl(
  s: Pick<TradeLifecycleState, "direction" | "entry"> & { lotSize: number },
  exit: number
): number {
  const diff = s.direction === "LONG" ? exit - s.entry : s.entry - exit;
  return diff * 100 * s.lotSize;
}

/**
 * Advances a single position bar-by-bar using intrabar extremes.
 * LONG stops and targets are checked against low/high; SHORT reversed.
 * Conservative ordering (stop before target when both are inside one bar)
 * avoids lookahead bias.
 *
 * Partial TP1 handling: Reaching TP1 closes 50% of the lot size at TP1.
 * The remaining 50% runner continues toward TP2 or SL.
 */
export class TradeLifecycle {
  constructor(
    public readonly state: TradeLifecycleState,
    private readonly model?: SpreadSlippageModel
  ) {}

  open(openedAt: number): TradeLifecycleState {
    if (this.state.state === "PLANNED" || this.state.state === "SUBMITTED") {
      this.state.state = "OPEN";
      this.state.openedAt = openedAt;
    }
    return this.state;
  }

  advance(bar: Candle): TradeLifecycleState {
    if (isTerminal(this.state.state)) {
      return this.state;
    }
    if (this.state.state === "PLANNED" || this.state.state === "SUBMITTED") {
      this.state.state = "OPEN";
      this.state.openedAt = bar.openTime;
    }
    const s = this.state;
    const long = s.direction === "LONG";

    // Conservative: if the bar could hit both SL and TP, assume SL first.
    const hitSl = long ? bar.low <= s.stopLoss : bar.high >= s.stopLoss;
    const hitTp2 = long ? bar.high >= s.takeProfit2 : bar.low <= s.takeProfit2;
    const hitTp1 = long ? bar.high >= s.takeProfit1 : bar.low <= s.takeProfit1;

    const exitSlPrice = this.model ? this.model.adjustedExit(s.direction, s.stopLoss) : s.stopLoss;
    const exitTp1Price = this.model ? this.model.adjustedExit(s.direction, s.takeProfit1) : s.takeProfit1;
    const exitTp2Price = this.model ? this.model.adjustedExit(s.direction, s.takeProfit2) : s.takeProfit2;

    const isTp1AlreadyHit = s.state === "TP1_HIT";

    if (hitSl) {
      const lotFraction = isTp1AlreadyHit ? 0.5 : 1.0;
      const slPnl = calculatePnl({ direction: s.direction, entry: s.entry, lotSize: s.lotSize * lotFraction }, exitSlPrice);
      s.state = "SL_HIT";
      s.exitReason = "stop loss";
      s.realizedPnl = isTp1AlreadyHit ? (s.tp1RealizedPnl ?? 0) + slPnl : slPnl;
    } else if (isTp1AlreadyHit && hitTp2) {
      const tp2Pnl = calculatePnl({ direction: s.direction, entry: s.entry, lotSize: s.lotSize * 0.5 }, exitTp2Price);
      s.state = "TP2_HIT";
      s.exitReason = "take profit 2";
      s.realizedPnl = (s.tp1RealizedPnl ?? 0) + tp2Pnl;
    } else if (!isTp1AlreadyHit) {
      if (hitTp2 && hitTp1) {
        const tp1Pnl = calculatePnl({ direction: s.direction, entry: s.entry, lotSize: s.lotSize * 0.5 }, exitTp1Price);
        const tp2Pnl = calculatePnl({ direction: s.direction, entry: s.entry, lotSize: s.lotSize * 0.5 }, exitTp2Price);
        s.tp1ClosedAt = bar.openTime;
        s.tp1RealizedPnl = tp1Pnl;
        s.state = "TP2_HIT";
        s.exitReason = "take profit 2";
        s.realizedPnl = tp1Pnl + tp2Pnl;
      } else if (hitTp2) {
        const tp2Pnl = calculatePnl({ direction: s.direction, entry: s.entry, lotSize: s.lotSize }, exitTp2Price);
        s.state = "TP2_HIT";
        s.exitReason = "take profit 2";
        s.realizedPnl = tp2Pnl;
      } else if (hitTp1) {
        const tp1Pnl = calculatePnl({ direction: s.direction, entry: s.entry, lotSize: s.lotSize * 0.5 }, exitTp1Price);
        s.state = "TP1_HIT";
        s.tp1ClosedAt = bar.openTime;
        s.tp1RealizedPnl = tp1Pnl;
        s.realizedPnl = tp1Pnl;
        s.exitReason = "take profit 1 (runner)";
      }
    }

    if (isTerminal(s.state)) {
      s.closedAt = bar.openTime;
    }
    return s;
  }
}
