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

export interface ScannerStats {
  readonly timestamp: number;
  readonly durationMs: number;
  readonly fetched: number;
  readonly newBars: number;
  readonly errors: readonly string[];
}

/**
 * Scanner: on each tick, fetches recent closed bars for every symbol×timeframe,
 * appends them to the cache, and reports the bars that are NEW. The pipeline
 * subscribes to these new bars and only acts on closed-bar events — no partial
 * bars ever reach strategies.
 */
export class Scanner {
  private isScanning = false;
  private lastStats: ScannerStats | null = null;

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly cache: CandleCache,
    private readonly cfg: ScannerConfig,
    private readonly log: Logger
  ) {}

  /** Indicates whether a scan pass is currently executing. */
  get scanning(): boolean {
    return this.isScanning;
  }

  /** Returns authoritative telemetry from the most recent scan pass, or null if no pass has run. */
  get lastScanStats(): ScannerStats | null {
    return this.lastStats;
  }

  /** One scan pass. Never throws — provider errors are collected, not raised. Single-flight enforced. */
  async tick(): Promise<ScanTickResult> {
    if (this.isScanning) {
      this.log.debug("scan tick skipped: scan already in progress");
      return { newBars: [], fetched: 0, errors: [] };
    }

    this.isScanning = true;
    const startTime = Date.now();
    try {
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
      const durationMs = Date.now() - startTime;
      this.lastStats = {
        timestamp: Date.now(),
        durationMs,
        fetched,
        newBars: newBars.length,
        errors,
      };

      return { newBars, fetched, errors };
    } catch (err) {
      const msg = `unexpected scanner error: ${err instanceof Error ? err.message : String(err)}`;
      this.log.error(msg, err);
      const durationMs = Date.now() - startTime;
      this.lastStats = {
        timestamp: Date.now(),
        durationMs,
        fetched: 0,
        newBars: 0,
        errors: [msg],
      };
      return { newBars: [], fetched: 0, errors: [msg] };
    } finally {
      this.isScanning = false;
    }
  }
}