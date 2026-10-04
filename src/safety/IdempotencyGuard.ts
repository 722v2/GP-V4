import type { Candle } from "../core/types/Candle.js";

/**
 * Guards against double-processing the same closed bar across restarts or
 * duplicate deliveries. Keys on symbol|timeframe|openTime; remembers the most
 * recent high-water mark per series.
 */
export class IdempotencyGuard {
  private processed = new Set<string>();
  private highWater = new Map<string, number>();
  private readonly maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  /** Returns true the first time a given bar is seen; false for duplicates. */
  claim(symbol: string, timeframe: string, openTime: number): boolean {
    const key = `${symbol}|${timeframe}|${openTime}`;
    if (this.processed.has(key)) return false;
    this.processed.add(key);
    if (this.processed.size > this.maxEntries) {
      // Evict roughly a quarter — high-water mark still prevents reprocessing.
      const excess = Math.floor(this.maxEntries * 0.25);
      let n = 0;
      for (const k of this.processed) {
        if (n++ >= excess) break;
        this.processed.delete(k);
      }
    }
    const markKey = `${symbol}|${timeframe}`;
    const prev = this.highWater.get(markKey) ?? -1;
    if (openTime > prev) this.highWater.set(markKey, openTime);
    return true;
  }

  isClaimed(symbol: string, timeframe: string, openTime: number): boolean {
    return this.processed.has(`${symbol}|${timeframe}|${openTime}`);
  }

  /** Bars at or before the high-water mark should be skipped for this series. */
  highWaterMark(symbol: string, timeframe: string): number {
    return this.highWater.get(`${symbol}|${timeframe}`) ?? -1;
  }

  /** Convenience: claim only if the bar is newer than the high-water mark. */
  claimIfNewer(candle: Candle): boolean {
    if (candle.openTime <= this.highWaterMark(candle.symbol, candle.timeframe)) return false;
    return this.claim(candle.symbol, candle.timeframe, candle.openTime);
  }
}
