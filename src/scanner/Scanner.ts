import type { MarketDataProvider } from "../marketdata/MarketDataProvider.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import type { CandleCache } from "../marketdata/CandleCache.js";
import type { Logger } from "../core/logging/Logger.js";

export interface ScannerConfig {
  symbols: readonly Symbol[];
  timeframes: readonly Timeframe[];
  /** Bars requested per fetch. */
  limit: number;
  scanIntervalMs: number;
}

export interface ScanTickResult {
  readonly newBars: readonly { symbol: Symbol; timeframe: Timeframe; openTime: number }[];
  readonly fetched: number;
  readonly errors: readonly string[];
}

/**
 * Scanner: on each tick, fetches recent closed bars for every symbol×timeframe,
 * appends them to the cache, and reports the bars that are NEW. The pipeline
 * subscribes to these new bars and only acts on closed-bar events — no partial
 * bars ever reach strategies.
 */
export class Scanner {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly cache: CandleCache,
    private readonly cfg: ScannerConfig,
    private readonly log: Logger
  ) {}

  /** One scan pass. Never throws — provider errors are collected, not raised. */
  async tick(): Promise<ScanTickResult> {
    const newBars: { symbol: Symbol; timeframe: Timeframe; openTime: number }[] = [];
    const errors: string[] = [];
    let fetched = 0;

    for (const symbol of this.cfg.symbols) {
      for (const timeframe of this.cfg.timeframes) {
        try {
          const series = await this.provider.fetchCandles({ symbol, timeframe, limit: this.cfg.limit });
          fetched += 1;
          const added = this.cache.append(series);
          for (const bar of added) {
            newBars.push({ symbol, timeframe, openTime: bar.openTime });
          }
        } catch (err) {
          const msg = `${symbol}:${timeframe} ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          this.log.warn(`scan error: ${msg}`);
        }
      }
    }

    this.log.debug("scan tick", { fetched, newBars: newBars.length, errors: errors.length });
    return { newBars, fetched, errors };
  }
}