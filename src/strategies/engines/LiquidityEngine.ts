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

    const equalHighClusters = detectEqualLevelClusters(
      swings.filter((s) => s.kind === "swing-high"),
      this.cfg.equalLevelTolerance
    );
    const equalLowClusters = detectEqualLevelClusters(
      swings.filter((s) => s.kind === "swing-low"),
      this.cfg.equalLevelTolerance
    );

    for (const eh of equalHighClusters) levels.push({ price: eh.price, kind: "equal-high", touchedAt: eh.timestamp });
    for (const el of equalLowClusters) levels.push({ price: el.price, kind: "equal-low", touchedAt: el.timestamp });

    // Directional validity & ATR proximity:
    // Upside liquidity target: level must be strictly ABOVE current price (last.close)
    // and within ATR proximity (upper.price - last.close <= nearLevelAtrMultiple * atr).
    // When multiple valid levels exist, select the NEWEST valid level (deterministic tie-breaking by price).
    const validHighs = equalHighClusters
      .filter((c) => c.price > last.close && c.price - last.close <= this.cfg.nearLevelAtrMultiple * atr)
      .sort((a, b) => b.timestamp - a.timestamp || a.price - b.price);

    if (validHighs.length > 0) {
      const upper = validHighs[0]!;
      evidence.push({
        source: "liquidity",
        kind: "equal-highs-overhead",
        detail: `equal highs near ${upper.price.toFixed(2)} — resting liquidity above`,
        weight: signedWeight("SHORT", 0.4),
      });
    }

    // Downside liquidity target: level must be strictly BELOW current price (last.close)
    // and within ATR proximity (last.close - lower.price <= nearLevelAtrMultiple * atr).
    // When multiple valid levels exist, select the NEWEST valid level (deterministic tie-breaking by price).
    const validLows = equalLowClusters
      .filter((c) => c.price < last.close && last.close - c.price <= this.cfg.nearLevelAtrMultiple * atr)
      .sort((a, b) => b.timestamp - a.timestamp || b.price - a.price);

    if (validLows.length > 0) {
      const lower = validLows[0]!;
      evidence.push({
        source: "liquidity",
        kind: "equal-lows-below",
        detail: `equal lows near ${lower.price.toFixed(2)} — resting liquidity below`,
        weight: signedWeight("LONG", 0.4),
      });
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

export interface EqualLevelCluster {
  readonly price: number;
  readonly timestamp: number;
  readonly swings: readonly SwingPoint[];
}

/**
 * Groups swing points that cluster within `tolerance`.
 * Returns each cluster's average price, the latest swing openTime (when the cluster was formed),
 * and the constituent swings.
 */
export function detectEqualLevelClusters(
  swings: readonly SwingPoint[],
  tolerance: number
): EqualLevelCluster[] {
  if (swings.length < 2) return [];
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const out: EqualLevelCluster[] = [];
  let cluster: SwingPoint[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]!;
    const clusterTop = cluster[cluster.length - 1]!.price;
    if (s.price - clusterTop <= tolerance) {
      cluster.push(s);
    } else {
      if (cluster.length >= 2) {
        out.push({
          price: cluster.reduce((a, s2) => a + s2.price, 0) / cluster.length,
          timestamp: Math.max(...cluster.map((s2) => s2.openTime)),
          swings: [...cluster],
        });
      }
      cluster = [s];
    }
  }
  if (cluster.length >= 2) {
    out.push({
      price: cluster.reduce((a, s2) => a + s2.price, 0) / cluster.length,
      timestamp: Math.max(...cluster.map((s2) => s2.openTime)),
      swings: [...cluster],
    });
  }
  return out;
}

/** Averages swing prices that cluster within `tolerance`; returns cluster mid prices. */
export function equalLevels(swings: readonly SwingPoint[], tolerance: number): number[] {
  return detectEqualLevelClusters(swings, tolerance).map((c) => c.price);
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
