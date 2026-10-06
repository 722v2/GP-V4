import type { Candle } from "../../core/types/Candle.js";
import type { AnalysisEngine, EngineContext, EngineOutput } from "../Engine.js";
import { signedWeight } from "../Engine.js";
import { ema } from "./IndicatorEngine.js";
import { averageTrueRange } from "./LiquidityEngine.js";

export interface RegimeEngineConfig {
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  atrPeriod: number;
}

export const DEFAULT_REGIME_CONFIG: RegimeEngineConfig = {
  fastEmaPeriod: 20,
  slowEmaPeriod: 50,
  atrPeriod: 14,
};

export type MarketRegime = "TRENDING_BULLISH" | "TRENDING_BEARISH" | "RANGING" | "HIGH_VOLATILITY";

/**
 * Market Regime Engine:
 * Identifies overall market condition (Trend vs Range vs High Volatility) to provide
 * macro contextual evidence for directional confluence.
 */
export class RegimeEngine implements AnalysisEngine {
  readonly id = "regime";

  constructor(private readonly cfg: RegimeEngineConfig = DEFAULT_REGIME_CONFIG) {}

  analyze(ctx: EngineContext): EngineOutput {
    const candles = ctx.candles;
    if (candles.length < this.cfg.slowEmaPeriod) {
      return { engine: this.id, evidence: [] };
    }

    const closes = candles.map((c: Candle) => c.close);
    const last = candles[candles.length - 1]!;
    const fastEma = ema(closes, this.cfg.fastEmaPeriod);
    const slowEma = ema(closes, this.cfg.slowEmaPeriod);

    if (fastEma.length === 0 || slowEma.length === 0) {
      return { engine: this.id, evidence: [] };
    }

    const currentFast = fastEma[fastEma.length - 1]!;
    const currentSlow = slowEma[slowEma.length - 1]!;
    const atr = averageTrueRange(candles, this.cfg.atrPeriod) || 1;

    const evidence = [];

    // Bullish Trend Regime: price > Fast EMA > Slow EMA
    if (last.close > currentFast && currentFast > currentSlow) {
      const separation = (currentFast - currentSlow) / atr;
      const weight = Math.min(0.4, 0.2 + separation * 0.1);
      evidence.push({
        source: "regime",
        kind: "regime-bullish-trend",
        detail: `price above EMA${this.cfg.fastEmaPeriod} > EMA${this.cfg.slowEmaPeriod} (bullish regime)`,
        weight: signedWeight("LONG", weight),
      });
    } else if (last.close < currentFast && currentFast < currentSlow) {
      const separation = (currentSlow - currentFast) / atr;
      const weight = Math.min(0.4, 0.2 + separation * 0.1);
      evidence.push({
        source: "regime",
        kind: "regime-bearish-trend",
        detail: `price below EMA${this.cfg.fastEmaPeriod} < EMA${this.cfg.slowEmaPeriod} (bearish regime)`,
        weight: signedWeight("SHORT", weight),
      });
    } else {
      evidence.push({
        source: "regime",
        kind: "regime-range-consolidation",
        detail: "price compressing around moving averages (ranging regime)",
        weight: 0,
      });
    }

    return { engine: this.id, evidence };
  }
}
