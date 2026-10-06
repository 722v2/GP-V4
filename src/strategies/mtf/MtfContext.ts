import type { Candle } from "../../core/types/Candle.js";
import type { Symbol, Timeframe } from "../../core/types/MarketTypes.js";
import type { CandleCache } from "../../marketdata/CandleCache.js";
import { StructureEngine } from "../engines/StructureEngine.js";
import { RegimeEngine } from "../engines/RegimeEngine.js";
import type { Evidence } from "../../core/types/Setup.js";

function totalScore(evidence: readonly Evidence[]): number {
  let total = 0;
  for (const e of evidence) {
    total += Math.max(-1, Math.min(1, e.weight));
  }
  return total;
}

export interface TimeframeContextSummary {
  readonly timeframe: Timeframe;
  readonly barCount: number;
  readonly lastClosedTime: number;
  readonly lastClose: number;
  readonly trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  readonly score: number;
  readonly regime: string;
  readonly rationale: string;
}

export interface MtfContext {
  readonly symbol: Symbol;
  readonly asOfTimestamp: number;
  readonly primaryTimeframe: "M1";
  readonly m5?: TimeframeContextSummary;
  readonly m15?: TimeframeContextSummary;
  readonly h1?: TimeframeContextSummary;
}

const structureEngine = new StructureEngine();
const regimeEngine = new RegimeEngine();

/**
 * Builds a higher-timeframe context summary from closed candles available in CandleCache up to asOfTimestamp.
 * Strictly enforces temporal isolation (no lookahead).
 */
export function buildTimeframeSummary(
  candles: readonly Candle[],
  timeframe: Timeframe
): TimeframeContextSummary | undefined {
  if (!candles || candles.length < 5) {
    return undefined;
  }
  const ctx = { symbol: candles[0]!.symbol, timeframe, candles };
  const structOut = structureEngine.analyze(ctx);
  const regimeOut = regimeEngine.analyze(ctx);

  const structScore = totalScore(structOut.evidence);
  const regimeScore = totalScore(regimeOut.evidence);
  const totalNet = structScore + regimeScore;

  let trend: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (totalNet >= 0.2) trend = "BULLISH";
  else if (totalNet <= -0.2) trend = "BEARISH";

  const lastBar = candles[candles.length - 1]!;
  const regimeDetail = regimeOut.evidence[0]?.detail ?? "normal";

  return {
    timeframe,
    barCount: candles.length,
    lastClosedTime: lastBar.openTime,
    lastClose: lastBar.close,
    trend,
    score: totalNet,
    regime: regimeDetail,
    rationale: `${timeframe} ${trend.toLowerCase()} (struct ${structScore.toFixed(2)}, regime ${regimeScore.toFixed(2)})`,
  };
}

/**
 * Constructs full MTF context for an M1 bar at asOfTimestamp using closed candles only.
 */
export function buildMtfContext(
  cache: CandleCache,
  symbol: Symbol,
  asOfTimestamp: number
): MtfContext {
  const m5Candles = cache.viewAsOf(symbol, "M5", asOfTimestamp);
  const m15Candles = cache.viewAsOf(symbol, "M15", asOfTimestamp);
  const h1Candles = cache.viewAsOf(symbol, "H1", asOfTimestamp);

  return {
    symbol,
    asOfTimestamp,
    primaryTimeframe: "M1",
    m5: buildTimeframeSummary(m5Candles, "M5"),
    m15: buildTimeframeSummary(m15Candles, "M15"),
    h1: buildTimeframeSummary(h1Candles, "H1"),
  };
}
