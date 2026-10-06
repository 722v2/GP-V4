import type { Candle } from "../../core/types/Candle.js";
import type { AnalysisEngine, EngineContext, EngineLevel, EngineOutput } from "../Engine.js";
import { signedWeight } from "../Engine.js";
import { averageTrueRange } from "./LiquidityEngine.js";

export interface Zone {
  readonly top: number;
  readonly bottom: number;
  readonly kind: "demand" | "supply";
  readonly openTime: number;
}

export interface ZoneEngineConfig {
  /** Maximum lookback bars to search for supply/demand zones. */
  lookbackBars: number;
  /** Proximity in ATR multiples to treat price as "testing" the zone. */
  nearZoneAtrMultiple: number;
  /** Minimum impulse size in ATR multiples following the base candle. */
  minImpulseAtrMultiple: number;
}

export const DEFAULT_ZONE_CONFIG: ZoneEngineConfig = {
  lookbackBars: 30,
  nearZoneAtrMultiple: 1.5,
  minImpulseAtrMultiple: 1.5,
};

/**
 * Detects supply and demand zones (order blocks):
 * - Demand zone: down-candle immediately preceding a strong bullish impulse.
 * - Supply zone: up-candle immediately preceding a strong bearish impulse.
 */
export function detectZones(candles: readonly Candle[], cfg: ZoneEngineConfig): Zone[] {
  if (candles.length < 5) return [];
  const atr = averageTrueRange(candles, 14) || 1;
  const zones: Zone[] = [];
  const start = Math.max(0, candles.length - cfg.lookbackBars);

  for (let i = start; i < candles.length - 2; i++) {
    const base = candles[i]!;
    const next1 = candles[i + 1]!;
    const next2 = candles[i + 2]!;

    // Bullish Impulse out of base (Demand Zone)
    if (base.close <= base.open) {
      const impulseMove = Math.max(next1.close, next2.close) - base.low;
      if (impulseMove >= cfg.minImpulseAtrMultiple * atr && next1.close > base.high) {
        zones.push({
          top: Math.max(base.open, base.close),
          bottom: base.low,
          kind: "demand",
          openTime: base.openTime,
        });
      }
    }

    // Bearish Impulse out of base (Supply Zone)
    if (base.close >= base.open) {
      const impulseMove = base.high - Math.min(next1.close, next2.close);
      if (impulseMove >= cfg.minImpulseAtrMultiple * atr && next1.close < base.low) {
        zones.push({
          top: base.high,
          bottom: Math.min(base.open, base.close),
          kind: "supply",
          openTime: base.openTime,
        });
      }
    }
  }

  return zones;
}

/**
 * Supply & Demand Zone Engine:
 * Evaluates whether price is currently reacting to or near a valid supply/demand zone.
 */
export class ZoneEngine implements AnalysisEngine {
  readonly id = "zone";

  constructor(private readonly cfg: ZoneEngineConfig = DEFAULT_ZONE_CONFIG) {}

  analyze(ctx: EngineContext): EngineOutput {
    const candles = ctx.candles;
    if (candles.length < 4) return { engine: this.id, evidence: [], levels: [] };

    const last = candles[candles.length - 1]!;
    const atr = averageTrueRange(candles, 14) || 1;
    const zones = detectZones(candles, this.cfg);

    const levels: EngineLevel[] = [];
    const evidence = [];

    for (const z of zones) {
      levels.push({
        price: (z.top + z.bottom) / 2,
        kind: z.kind === "demand" ? "demand-zone" : "supply-zone",
        touchedAt: z.openTime,
      });
    }

    // Check if current candle is near or inside a recent demand zone
    const demandZones = zones
      .filter((z) => z.kind === "demand" && z.openTime < last.openTime)
      .filter((z) => last.close >= z.bottom - 0.2 * atr && last.close <= z.top + this.cfg.nearZoneAtrMultiple * atr)
      .sort((a, b) => b.openTime - a.openTime);

    if (demandZones.length > 0) {
      const nearestDemand = demandZones[0]!;
      evidence.push({
        source: "zone",
        kind: "demand-zone-support",
        detail: `price reacting near demand zone [${nearestDemand.bottom.toFixed(2)} - ${nearestDemand.top.toFixed(2)}]`,
        weight: signedWeight("LONG", 0.45),
      });
    }

    // Check if current candle is near or inside a recent supply zone
    const supplyZones = zones
      .filter((z) => z.kind === "supply" && z.openTime < last.openTime)
      .filter((z) => last.close <= z.top + 0.2 * atr && last.close >= z.bottom - this.cfg.nearZoneAtrMultiple * atr)
      .sort((a, b) => b.openTime - a.openTime);

    if (supplyZones.length > 0) {
      const nearestSupply = supplyZones[0]!;
      evidence.push({
        source: "zone",
        kind: "supply-zone-resistance",
        detail: `price reacting near supply zone [${nearestSupply.bottom.toFixed(2)} - ${nearestSupply.top.toFixed(2)}]`,
        weight: signedWeight("SHORT", 0.45),
      });
    }

    return { engine: this.id, evidence, levels };
  }
}
