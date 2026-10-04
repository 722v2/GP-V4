import type { MarketDataProvider, CandleRequest } from "../MarketDataProvider.js";
import type { CandleSeries, Candle } from "../../core/types/Candle.js";
import type { Symbol, Timeframe } from "../../core/types/MarketTypes.js";
import { validateCandleSeries } from "../validation.js";

/**
 * Replayable market-data source backed by an in-memory candle set (fixtures).
 * Used for BACKTEST and REPLAY so historical scans are deterministic and never
 * touch the network. Fetches return only bars closed as-of the replay clock.
 */
export class FixtureSource implements MarketDataProvider {
  readonly name = "fixture";

  constructor(private readonly seriesByKey: Map<string, readonly Candle[]>) {}

  static fromSeries(series: readonly CandleSeries[]): FixtureSource {
    const map = new Map<string, Candle[]>();
    for (const s of series) {
      map.set(`${s.symbol}:${s.timeframe}`, [...s.candles]);
    }
    return new FixtureSource(map);
  }

  async fetchCandles(req: CandleRequest): Promise<CandleSeries> {
    const key = `${req.symbol}:${req.timeframe}`;
    const all = this.seriesByKey.get(key);
    if (!all) {
      return { symbol: req.symbol, timeframe: req.timeframe, candles: [] };
    }
    const candles = all.slice(-req.limit);
    const series: CandleSeries = { symbol: req.symbol, timeframe: req.timeframe, candles };
    // Fixtures may include still-open bars; validation would reject those, so we
    // intentionally do not run future-close checks here — replay filters by asOf.
    return validateCandleSeries(series, { partialLastAllowed: true });
  }

  /** All bars for a series, used by replay engines that step a virtual clock. */
  all(symbol: Symbol, timeframe: Timeframe): readonly Candle[] {
    return this.seriesByKey.get(`${symbol}:${timeframe}`) ?? [];
  }
}