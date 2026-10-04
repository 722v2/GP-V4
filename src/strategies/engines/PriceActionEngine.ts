import type { Candle } from "../../core/types/Candle.js";
import type { AnalysisEngine, EngineContext, EngineOutput } from "../Engine.js";
import { signedWeight } from "../Engine.js";
import { averageTrueRange } from "./LiquidityEngine.js";

export interface PriceActionEngineConfig {
  /** Minimum body/range ratio for a bar to count as "strong" (marubozu-like). */
  strongBodyRatio: number;
  /** Minimum body size in ATR multiples for a strong candle. */
  strongBodyAtrMultiple: number;
}

export const DEFAULT_PA_CONFIG: PriceActionEngineConfig = {
  strongBodyRatio: 0.6,
  strongBodyAtrMultiple: 0.8,
};

/** Price-action engine: strong (marubozu-like) candles, engulfing patterns, wick rejection. */
export class PriceActionEngine implements AnalysisEngine {
  readonly id = "price-action";

  constructor(private readonly cfg: PriceActionEngineConfig = DEFAULT_PA_CONFIG) {}

  analyze(ctx: EngineContext): EngineOutput {
    const candles = ctx.candles;
    if (candles.length < 3) return { engine: this.id, evidence: [] };
    const evidence = [];
    const last = candles[candles.length - 1]!;
    const atr = averageTrueRange(candles, 14) || 1;

    const strong = strongCandle(last, atr, this.cfg);
    if (strong) {
      evidence.push({
        source: "price-action",
        kind: strong === "bullish" ? "strong-bull-candle" : "strong-bear-candle",
        detail: `closed-bar body ${(bodyRatio(last) * 100).toFixed(0)}% of range, ${(Math.abs(last.close - last.open) / atr).toFixed(2)} ATR`,
        weight: signedWeight(strong === "bullish" ? "LONG" : "SHORT", 0.6),
      });
    }

    const engulf = engulfing(candles);
    if (engulf) {
      evidence.push({
        source: "price-action",
        kind: engulf === "bullish" ? "bullish-engulfing" : "bearish-engulfing",
        detail: `last bar body engulfs prior bar body`,
        weight: signedWeight(engulf === "bullish" ? "LONG" : "SHORT", 0.45),
      });
    }

    const rejection = wickRejection(last, atr);
    if (rejection) {
      evidence.push({
        source: "price-action",
        kind: rejection === "bullish" ? "lower-wick-rejection" : "upper-wick-rejection",
        detail: `${rejection === "bullish" ? "lower" : "upper"} wick ${(rejection === "bullish" ? lowerWick(last) : upperWick(last)).toFixed(2)} vs ATR ${atr.toFixed(2)}`,
        weight: signedWeight(rejection === "bullish" ? "LONG" : "SHORT", 0.35),
      });
    }

    return { engine: this.id, evidence };
  }
}

export function bodyRatio(c: Candle): number {
  const range = c.high - c.low;
  if (range <= 0) return 0;
  return Math.abs(c.close - c.open) / range;
}

/** "bullish" | "bearish" | null — a directional candle with a dominant body. */
export function strongCandle(c: Candle, atr: number, cfg: PriceActionEngineConfig): "bullish" | "bearish" | null {
  const body = Math.abs(c.close - c.open);
  if (bodyRatio(c) < cfg.strongBodyRatio) return null;
  if (body < cfg.strongBodyAtrMultiple * atr) return null;
  return c.close > c.open ? "bullish" : c.close < c.open ? "bearish" : null;
}

export function engulfing(candles: readonly Candle[]): "bullish" | "bearish" | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2]!;
  const bull = last.close > last.open && prev.close < prev.open && last.close >= prev.open && last.open <= prev.close;
  if (bull) return "bullish";
  const bear = last.close < last.open && prev.close > prev.open && last.close <= prev.open && last.open >= prev.close;
  if (bear) return "bearish";
  return null;
}

export function upperWick(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

export function lowerWick(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

/** Long rejection wick relative to ATR. */
export function wickRejection(c: Candle, atr: number): "bullish" | "bearish" | null {
  const lw = lowerWick(c);
  const uw = upperWick(c);
  if (lw > atr * 0.8 && lw > 2 * uw) return "bullish";
  if (uw > atr * 0.8 && uw > 2 * lw) return "bearish";
  return null;
}
