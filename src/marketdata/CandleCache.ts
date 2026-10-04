import type { Candle, CandleSeries } from "../core/types/Candle.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import { seriesKey } from "../core/types/Candle.js";

/**
 * In-memory rolling candle cache. Appends are idempotent by openTime:
 * re-delivering a bar is a no-op, and bars older than the last stored bar
 * are rejected (no backfill-through-the-cache).
 */
export class CandleCache {
  private series = new Map<string, Candle[]>();
  private maxBars: number;

  constructor(maxBarsPerSeries = 500) {
    this.maxBars = maxBarsPerSeries;
  }

  /** Returns the bars that were newly appended (empty if none). */
  append(series: CandleSeries): Candle[] {
    const key = seriesKey(series.symbol, series.timeframe);
    const existing = this.series.get(key) ?? [];
    const lastOpen = existing.length > 0 ? existing[existing.length - 1]!.openTime : -1;
    const added: Candle[] = [];
    for (const c of series.candles) {
      if (c.openTime <= lastOpen) continue;
      existing.push(c);
      added.push(c);
      if (existing.length > this.maxBars) existing.splice(0, existing.length - this.maxBars);
    }
    this.series.set(key, existing);
    return added;
  }

  get(symbol: Symbol, timeframe: Timeframe): readonly Candle[] {
    return this.series.get(seriesKey(symbol, timeframe)) ?? [];
  }

  latest(symbol: Symbol, timeframe: Timeframe): Candle | undefined {
    const list = this.get(symbol, timeframe);
    return list.length > 0 ? list[list.length - 1] : undefined;
  }

  /** Closed-bar view ending at (and excluding) any bar with closeTime > asOf. Used by replay/backtest. */
  viewAsOf(symbol: Symbol, timeframe: Timeframe, asOf: number): readonly Candle[] {
    return this.get(symbol, timeframe).filter((c) => c.closeTime <= asOf);
  }

  clear(): void {
    this.series.clear();
  }
}
