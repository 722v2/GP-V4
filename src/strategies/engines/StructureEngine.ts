import type { Candle } from "../../core/types/Candle.js";
import type { AnalysisEngine, EngineContext, EngineLevel, EngineOutput } from "../Engine.js";
import { signedWeight } from "../Engine.js";

export interface SwingPoint {
  readonly openTime: number;
  readonly price: number;
  readonly kind: "swing-high" | "swing-low";
}

export interface StructureEngineConfig {
  /** Bars on each side that must be lower (for a high) / higher (for a low). */
  lookbackBars: number;
  /** Minimum swing separation in price units to consider two swings distinct. */
  minSwingSeparation: number;
}

export const DEFAULT_STRUCTURE_CONFIG: StructureEngineConfig = {
  lookbackBars: 3,
  minSwingSeparation: 0.5,
};

/**
 * Market-structure engine: swing detection with fractal-style confirmation,
 * break-of-structure (BOS) classification, and trend bias.
 */
export class StructureEngine implements AnalysisEngine {
  readonly id = "structure";

  constructor(private readonly cfg: StructureEngineConfig = DEFAULT_STRUCTURE_CONFIG) {}

  analyze(ctx: EngineContext): EngineOutput {
    const candles = ctx.candles;
    const swings = detectSwings(candles, this.cfg);
    const levels: EngineLevel[] = swings.map((s) => ({
      price: s.price,
      kind: s.kind,
      touchedAt: s.openTime,
    }));
    const evidence = [];
    const bias = trendBias(candles, swings);
    if (bias !== 0) {
      evidence.push({
        source: "structure",
        kind: bias > 0 ? "higher-highs-higher-lows" : "lower-highs-lower-lows",
        detail: `recent swings suggest ${bias > 0 ? "bullish" : "bearish"} structure`,
        weight: signedWeight(bias > 0 ? "LONG" : "SHORT", Math.abs(bias)),
      });
    }
    const bos = lastBreakOfStructure(candles, swings);
    if (bos) {
      evidence.push({
        source: "structure",
        kind: bos.direction === "LONG" ? "bullish-bos" : "bearish-bos",
        detail: `broke ${bos.direction === "LONG" ? "swing high" : "swing low"} at ${bos.level.toFixed(2)} on close`,
        weight: signedWeight(bos.direction, 0.5),
      });
    }
    return { engine: this.id, evidence, levels };
  }
}

/** Fractal swing detection: a high with `k` lower highs on both sides (k = lookbackBars). */
export function detectSwings(candles: readonly Candle[], cfg: StructureEngineConfig): readonly SwingPoint[] {
  const k = cfg.lookbackBars;
  const swings: SwingPoint[] = [];
  for (let i = k; i < candles.length - k; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const other = candles[j]!;
      if (other.high >= c.high) isHigh = false;
      if (other.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ openTime: c.openTime, price: c.high, kind: "swing-high" });
    if (isLow) swings.push({ openTime: c.openTime, price: c.low, kind: "swing-low" });
  }
  return dedupeSwings(swings, cfg.minSwingSeparation);
}

function dedupeSwings(swings: readonly SwingPoint[], minSep: number): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (const s of swings) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === s.kind && Math.abs(prev.price - s.price) < minSep) continue;
    out.push(s);
  }
  return out;
}

/** +1 bullish (HH/HL sequence), -1 bearish (LH/LL), 0 unclear. */
export function trendBias(candles: readonly Candle[], swings: readonly SwingPoint[]): number {
  const highs = swings.filter((s) => s.kind === "swing-high").slice(-2);
  const lows = swings.filter((s) => s.kind === "swing-low").slice(-2);
  if (highs.length < 2 || lows.length < 2) return 0;
  const hh = highs[1]!.price > highs[0]!.price;
  const hl = lows[1]!.price > lows[0]!.price;
  const lh = highs[1]!.price < highs[0]!.price;
  const ll = lows[1]!.price < lows[0]!.price;
  if (hh && hl) return 0.6;
  if (lh && ll) return -0.6;
  return 0;
}

export interface BreakOfStructure {
  readonly direction: "LONG" | "SHORT";
  readonly level: number;
  readonly openTime: number;
}

/** Most recent close through the most recent opposing swing. Uses closed bars only. */
export function lastBreakOfStructure(candles: readonly Candle[], swings: readonly SwingPoint[]): BreakOfStructure | null {
  if (candles.length < 2 || swings.length === 0) return null;
  const last = candles[candles.length - 1]!;
  const prior = candles[candles.length - 2]!;
  const lastHigh = [...swings].reverse().find((s) => s.kind === "swing-high" && s.openTime < prior.openTime);
  const lastLow = [...swings].reverse().find((s) => s.kind === "swing-low" && s.openTime < prior.openTime);
  if (lastHigh && prior.close <= lastHigh.price && last.close > lastHigh.price) {
    return { direction: "LONG", level: lastHigh.price, openTime: last.openTime };
  }
  if (lastLow && prior.close >= lastLow.price && last.close < lastLow.price) {
    return { direction: "SHORT", level: lastLow.price, openTime: last.openTime };
  }
  return null;
}
