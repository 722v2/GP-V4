import type { ScanTickResult } from "../scanner/Scanner.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";

/**
 * Converts a scan tick into candle.closed events, deduplicated by
 * symbol|timeframe|openTime so a repeated bar can never trigger the pipeline
 * twice within a run.
 */
export function collectClosedBarEvents(tick: ScanTickResult): { symbol: Symbol; timeframe: Timeframe; openTime: number }[] {
  const seen = new Set<string>();
  const out: { symbol: Symbol; timeframe: Timeframe; openTime: number }[] = [];
  for (const b of tick.newBars) {
    const key = `${b.symbol}|${b.timeframe}|${b.openTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol: b.symbol, timeframe: b.timeframe, openTime: b.openTime });
  }
  return out;
}