import type { Candle } from "../core/types/Candle.js";
import type { CycleOutcome } from "../pipeline/types.js";
import type { TradingPipeline } from "../pipeline/TradingPipeline.js";
import type { CandleCache } from "../marketdata/CandleCache.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import { AppError, ErrorCode } from "../core/logging/Logger.js";

export interface ReplayResult {
  readonly cycles: readonly CycleOutcome[];
  readonly candlesProcessed: number;
}

/**
 * Drives a live TradingPipeline over historical fixtures one bar at a time.
 * Temporal isolation: each bar is appended to the cache only after being "closed"
 * by the virtual clock, so strategies see exactly what they would have seen live.
 */
export class ReplayRunner {
  constructor(
    private readonly pipeline: TradingPipeline,
    private readonly cache: CandleCache,
    private readonly opts: { warmupBars?: number } = {}
  ) {}

  async run(fixtures: readonly Candle[]): Promise<ReplayResult> {
    if (fixtures.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "replay requires at least one fixture candle");
    const sorted = [...fixtures].sort((a, b) => a.openTime - b.openTime);
    const symbol = sorted[0]!.symbol as Symbol;
    const timeframe = sorted[0]!.timeframe as Timeframe;
    const warmup = this.opts.warmupBars ?? 5;
    const cycles: CycleOutcome[] = [];

    if (sorted.length > warmup) {
      const warmupBars = sorted.slice(0, warmup);
      this.cache.append({ symbol, timeframe, candles: warmupBars });
    }

    for (let i = warmup; i < sorted.length; i++) {
      const bar = sorted[i]!;
      this.cache.append({ symbol, timeframe, candles: [bar] });
      const outcome = await this.pipeline.onBarClosed(symbol, timeframe);
      cycles.push(outcome);
    }

    return { cycles, candlesProcessed: Math.max(0, sorted.length - warmup) };
  }
}
