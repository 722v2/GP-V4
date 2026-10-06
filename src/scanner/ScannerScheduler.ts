import type { Timeframe } from "../core/types/MarketTypes.js";
import { TIMEFRAME_MS } from "../core/types/MarketTypes.js";
import type { Logger } from "../core/logging/Logger.js";

/**
/ Calculates remaining milliseconds until the next candle-close boundary
 * across the specified timeframes, plus a small buffer offset (default 500ms).
 * Capped at fallbackIntervalMs and bounded at a minimum of 100ms.
 */
export function calculateMsToNextCandleClose(
  timeframes: readonly Timeframe[],
  now: number,
  fallbackIntervalMs: number,
  bufferMs = 500
): number {
  if (!timeframes || timeframes.length === 0) {
    return Math.max(100, fallbackIntervalMs);
  }

  let minMsUntilClose = Infinity;
  for (const tf of timeframes) {
    const tfMs = TIMEFRAME_MS[tf];
    if (!tfMs || tfMs <= 0) continue;

    const elapsed = now % tfMs;
    let msRemaining = tfMs - elapsed;
    if (msRemaining <= 0) {
      msRemaining = tfMs;
    }
    const targetDelay = msRemaining + bufferMs;
    if (targetDelay < minMsUntilClose) {
      minMsUntilClose = targetDelay;
    }
  }

  if (!isFinite(minMsUntilClose) || minMsUntilClose <= 0) {
    return Math.max(100, fallbackIntervalMs);
  }

  return Math.max(100, Math.min(minMsUntilClose, fallbackIntervalMs));
}

export interface ScannerSchedulerConfig {
  readonly timeframes: readonly Timeframe[];
  readonly scanIntervalMs: number;
  readonly log: Logger;
  readonly runPass: () => Promise<void>;
  readonly nowFn?: () => number;
  readonly bufferMs?: number;
}

/**
 * Candle-close aware scanner scheduler.
 * Single-flight pass execution, uncaught error protection, and clean idempotent shutdown.
 */
export class ScannerScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isStopped = false;
  private isExecutingPass = false;

  constructor(private readonly cfg: ScannerSchedulerConfig) {}

  get running(): boolean {
    return this.isRunning;
  }

  get stopped(): boolean {
    return this.isStopped;
  }

  get executing(): boolean {
    return this.isExecutingPass;
  }

  /**
   * Starts the scheduler and immediately runs the first scan pass.
   */
  async start(): Promise<void> {
    if (this.isRunning || this.isStopped) return;
    this.isRunning = true;

    await this.executePass();
    this.scheduleNext();
  }

  /**
   * Executes one pass safely, ensuring uncaught errors do not crash or derail the scheduler.
   */
  async executePass(): Promise<void> {
    if (this.isStopped) return;
    if (this.isExecutingPass) {
      this.cfg.log.debug("scanner scheduler pass skipped: previous pass still executing");
      return;
    }

    this.isExecutingPass = true;
    try {
      await this.cfg.runPass();
    } catch (err) {
      this.cfg.log.error(
        `uncaught error in scanner pass: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    } finally {
      this.isExecutingPass = false;
    }
  }

  /**
   * Schedules the next tick using candle-close aware alignment.
   */
  private scheduleNext(): void {
    if (this.isStopped) return;

    const now = (this.cfg.nowFn ?? Date.now)();
    const delayMs = calculateMsToNextCandleClose(
      this.cfg.timeframes,
      now,
      this.cfg.scanIntervalMs,
      this.cfg.bufferMs ?? 500
    );

    this.timer = setTimeout(async () => {
      this.timer = null;
      if (this.isStopped) return;
      await this.executePass();
      this.scheduleNext();
    }, delayMs);
  }

  /**
   * Dynamically updates the scan interval at runtime without restarting the scheduler.
   */
  updateInterval(intervalMs: number): void {
    if (intervalMs > 0) {
      (this.cfg as { scanIntervalMs: number }).scanIntervalMs = intervalMs;
      if (this.isRunning && !this.isStopped && this.timer !== null) {
        clearTimeout(this.timer);
        this.timer = null;
        this.scheduleNext();
      }
    }
  }

  /**
   * Idempotent clean shutdown. Cancels pending timers and prevents future passes.
   */
  stop(): void {
    this.isStopped = true;
    this.isRunning = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
