import type { Candle } from "../core/types/Candle.js";
import type { Setup, Direction, Evidence } from "../core/types/Setup.js";
import type { AnalysisEngine, EngineContext, EngineOutput } from "./Engine.js";
import { averageTrueRange } from "./engines/LiquidityEngine.js";
import { strongCandle, DEFAULT_PA_CONFIG } from "./engines/PriceActionEngine.js";
import { signedWeight } from "./Engine.js";

export interface StrongCandleStrategyConfig {
  /** Minimum ATR-normalized body for the trigger candle. */
  strongBodyAtrMultiple: number;
  /** Minimum body/range ratio for the trigger candle. */
  strongBodyRatio: number;
  /** Stop distance in ATR multiples beyond the trigger candle's extreme. */
  stopAtrMultiple: number;
  /** TP1 / TP2 as R-multiples of the stop distance. */
  tp1R: number;
  tp2R: number;
  /** Setup expires after this many bars without a fill (set by pipeline). */
  expiryBars: number;
}

export const DEFAULT_STRONG_CANDLE_CONFIG: StrongCandleStrategyConfig = {
  strongBodyAtrMultiple: 0.8,
  strongBodyRatio: 0.6,
  stopAtrMultiple: 0.3,
  tp1R: 1,
  tp2R: 2,
  expiryBars: 3,
};

/**
 * Strong-candle strategy: when the last closed bar is a marubozu-like candle in
 * the direction of confluence bias, propose a Setup with entry at close, stop
 * beyond the candle extreme, and R-multiple targets. Stateless and deterministic.
 */
export class StrongCandleStrategy implements AnalysisEngine {
  readonly id = "strong-candle";

  constructor(
    private readonly cfg: StrongCandleStrategyConfig = DEFAULT_STRONG_CANDLE_CONFIG,
    private readonly idPrefix = "sc"
  ) {}

  /** Returns a Setup when the last closed bar qualifies, else null. */
  evaluate(ctx: EngineContext, biasDirection: Direction | null): Setup | null {
    const candles = ctx.candles;
    if (candles.length < 5 || !biasDirection) return null;
    const last = candles[candles.length - 1]!;
    const atr = averageTrueRange(candles, 14) || 1;

    const strong = strongCandle(last, atr, {
      strongBodyRatio: this.cfg.strongBodyRatio,
      strongBodyAtrMultiple: this.cfg.strongBodyAtrMultiple,
    });
    if (!strong) return null;
    const direction: Direction = strong === "bullish" ? "LONG" : "SHORT";
    if (direction !== biasDirection) return null;

    const body = Math.abs(last.close - last.open);
    const entry = last.close;
    const stopDistance = body + this.cfg.stopAtrMultiple * atr;
    const stopLoss = direction === "LONG" ? last.low - this.cfg.stopAtrMultiple * atr : last.high + this.cfg.stopAtrMultiple * atr;
    const takeProfit1 = direction === "LONG" ? entry + this.cfg.tp1R * stopDistance : entry - this.cfg.tp1R * stopDistance;
    const takeProfit2 = direction === "LONG" ? entry + this.cfg.tp2R * stopDistance : entry - this.cfg.tp2R * stopDistance;
    const invalidationPrice = stopLoss;

    const evidence: Evidence[] = [
      {
        source: "strong-candle",
        kind: direction === "LONG" ? "strong-bull-trigger" : "strong-bear-trigger",
        detail: `body ${(bodyRatioOf(last) * 100).toFixed(0)}% of range, ${(body / atr).toFixed(2)} ATR; stop ${stopDistance.toFixed(2)}`,
        weight: signedWeight(direction, 0.7),
      },
    ];

    return {
      id: `${this.idPrefix}:${ctx.symbol}:${ctx.timeframe}:${last.openTime}`,
      strategyId: this.id,
      symbol: ctx.symbol as Setup["symbol"],
      timeframe: ctx.timeframe,
      direction,
      barOpenTime: last.openTime,
      createdAt: Date.now(),
      state: "NEW",
      entry,
      stopLoss,
      takeProfit1,
      takeProfit2,
      invalidationPrice,
      rationale: `Strong ${direction.toLowerCase()} candle close on ${ctx.timeframe}; entry ${entry.toFixed(2)}, SL ${stopLoss.toFixed(2)}`,
      evidence,
    };
  }

  /** Engine-compat output (unused fields). Kept for engine registry symmetry. */
  analyze(ctx: EngineContext): EngineOutput {
    const setup = this.evaluate(ctx, null);
    return { engine: this.id, evidence: setup ? setup.evidence : [] };
  }

  expiryOpenTime(ctx: EngineContext): number {
    const last = ctx.candles[ctx.candles.length - 1];
    return last ? last.openTime + this.cfg.expiryBars * tfMs(ctx.timeframe) : 0;
  }
}

function bodyRatioOf(c: Candle): number {
  const range = c.high - c.low;
  return range <= 0 ? 0 : Math.abs(c.close - c.open) / range;
}

function tfMs(tf: string): number {
  const map: Record<string, number> = {
    M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000, H4: 14_400_000, D1: 86_400_000,
  };
  return map[tf] ?? 300_000;
}

export { DEFAULT_PA_CONFIG };
