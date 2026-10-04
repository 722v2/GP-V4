import type { Symbol, Timeframe } from "./MarketTypes.js";

/** A single completed OHLCV bar. Invariant: high >= max(open, close), low <= min(open, close), vol >= 0. */
export interface Candle {
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  /** Bar open time, epoch ms, UTC. */
  readonly openTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  /** Bar close time, epoch ms, UTC. */
  readonly closeTime: number;
}

export interface CandleSeries {
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  /** Ordered ascending by openTime, all bars closed (no partial current bar). */
  readonly candles: readonly Candle[];
}

/** A tick-level quote used for spread modelling. */
export interface Quote {
  readonly symbol: Symbol;
  readonly timestamp: number;
  readonly bid: number;
  readonly ask: number;
}

export function seriesKey(symbol: Symbol, timeframe: Timeframe): string {
  return `${symbol}:${timeframe}`;
}
