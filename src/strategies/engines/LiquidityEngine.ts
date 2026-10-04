import type { Candle } from "../../core/types/Candle.js";
import type { AnalysisEngine, EngineContext, EngineLevel, EngineOutput } from "../Engine.js";
import { signedWeight } from "../Engine.js";
import { detectSwings, type SwingPoint } from "./StructureEngine.js";
import { DEFAULT_STRUCTURE_CONFIG } from "./StructureEngine.js";

export interface LiquidityEngineConfig {
  /** Price tolerance for treating two swing extremes as an equal level (in price units). */
  equalLevelTolerance: number;
  /** How far price can be from a level (in ATR multiples) to count as "near". */
  nearLevelAtrMultiple: number;
  /** Swing-detection lookback used for liquidity levels (smaller than structure's). */
  swingLookbackBars: number;
}

export const DEFAULT_LIQUIDITY_CONFIG: LiquidityEngineConfig = {
  equalLevelTolerance: 0.3,
  nearLevelAtrMultiple: 1.5,
  swingLookbackBars: 2,
};

/**
 * Liquidity engine: equal highs/lows (pools of resting stops), proximity of price
 * to those pools, and stop-run wicks that sweep a level then reclaim it.
 */
export class LiquidityEngine implements AnalysisEngine {
  readonly id = "liquidity";

  constructor(
    cfg: Partial<LiquidityEngineConfig> = {}
  ) {
    this.cfg = { ...DEFAULT_LIQUIDITY_CONFIG, ...cfg };
  }

  private readonly cfg: LiquidityEngineConfig;

  analyze(ctx: EngineContext): EngineOutput {
    const candles = ctx.candles;
    if (candles.length < 5) return { engine: this.id, evidence: [] };
    const swings = detectSwings(candles, { ...DEFAULT_STRUCTURE_CONFIG, lookbackBars: this.cfg.swingLookbackBars });
    const last = candles[candles.length - 1]!;
    const atr = averageTrueRange(candles, 14) || 1;

    const evidence = [];
    const levels: EngineLevel[] = [];

    const equalHighs = equalLevels(swings.filter((s) => s.kind === "swing-high"), this.cfg.equalLevelTolerance);
    const equalLows = equalLevels(swings.filter((s) => s.kind === "swing-low"), this.cfg.equalLevelTolerance);
    for (const eh of equalHighs) levels.push({ price: eh, kind: "equal-high", touchedAt: last.openTime });
    for (const el of equalLows) levels.push({ price: el, kind: "equal-low", touchedAt: last.openTime });

    if (equalHighs.length > 0) {
      const upper = Math.min(...equalHighs);
      if (upper - last.close <= this.cfg.nearLevelAtrMultiple * atr) {
        evidence.push({
          source: "liquidity",
          kind: "equal-highs-overhead",
          detail: `equal highs near ${upper.toFixed(2)} — resting liquidity above`,
          weight: signedWeight("SHORT", 0.4),
        });
      }
    }
    if (equalLows.length > 0) {
      const lower = Math.max(...equalLows);
      if (last.close - lower <= this.cfg.nearLevelAtrMultiple * atr) {
        evidence.push({
          source: "liquidity",
          kind: "equal-lows-below",
          detail: `equal lows near ${lower.toFixed(2)} — resting liquidity below`,
          weight: signedWeight("LONG", 0.4),
        });
      }
    }

    const sweep = detectSweep(candles, swings);
    if (sweep) {
      evidence.push({
        source: "liquidity",
        kind: sweep.direction === "LONG" ? "sell-side-sweep" : "buy-side-sweep",
        detail: `wick swept ${sweep.direction === "LONG" ? "below" : "above"} ${sweep.level.toFixed(2)} then closed back through`,
        weight: signedWeight(sweep.direction, 0.55),
      });
    }

    return { engine: this.id, evidence, levels };
  }
}

/** Averages swing prices that cluster within `tolerance`; returns cluster mid prices. */
export function equalLevels(swings: readonly SwingPoint[], tolerance: number): number[] {
  if (swings.length < 2) return [];
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const out: number[] = [];
  let cluster: SwingPoint[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]!;
    const clusterTop = cluster[cluster.length - 1]!.price;
    if (s.price - clusterTop <= tolerance) {
      cluster.push(s);
    } else {
      if (cluster.length >= 2) out.push(cluster.reduce((a, s2) => a + s2.price, 0) / cluster.length);
      cluster = [s];
    }
  }
  if (cluster.length >= 2) out.push(cluster.reduce((a, s2) => a + s2.price, 0) / cluster.length);
  return out;
}

export interface Sweep {
  readonly direction: "LONG" | "SHORT";
  readonly level: number;
  readonly openTime: number;
}

/**
 * Liquidity sweep: the last bar wicked beyond a swing but closed back on the other
 * side (bearish for swept highs, bullish for swept lows).
 */
export function detectSweep(candles: readonly Candle[], swings: readonly SwingPoint[]): Sweep | null {
  if (candles.length === 0) return null;
  const last = candles[candles.length - 1]!;
  for (const s of swings) {
    if (s.openTime >= last.openTime) continue;
    if (s.kind === "swing-low" && last.low < s.price && last.close > s.price) {
      return { direction: "LONG", level: s.price, openTime: last.openTime };
    }
    if (s.kind === "swing-high" && last.high > s.price && last.close < s.price) {
      return { direction: "SHORT", level: s.price, openTime: last.openTime };
    }
  }
  return null;
}

export function averageTrueRange(candles: readonly Candle[], period: number): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}
