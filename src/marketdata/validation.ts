import { z } from "zod";
import type { Candle, CandleSeries } from "../core/types/Candle.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import { TIMEFRAME_MS, isTimeframe } from "../core/types/MarketTypes.js";
import { seriesKey } from "../core/types/Candle.js";

export const CandleSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().refine(isTimeframe, "unknown timeframe"),
  openTime: z.number().int().nonnegative(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().finite().min(0),
  closeTime: z.number().int().nonnegative(),
});

export class CandleValidationError extends Error {
  constructor(
    message: string,
    public readonly details: readonly string[]
  ) {
    super(message);
    this.name = "CandleValidationError";
  }
}

/**
 * Validates structural invariants of a normalized candle series.
 * Throws on any violation — bad data must never enter the pipeline.
 */
export function validateCandleSeries(
  series: CandleSeries,
  opts: { partialLastAllowed?: boolean; now?: number } = {}
): CandleSeries {
  const errors: string[] = [];
  const { symbol, timeframe, candles } = series;
  const now = opts.now ?? Date.now();

  if (candles.length === 0) errors.push("series is empty");
  const tfMs = TIMEFRAME_MS[timeframe];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const idx = `candle[${i}]`;

    if (c.symbol !== symbol) errors.push(`${idx}: symbol mismatch ${c.symbol} != ${symbol}`);
    if (c.timeframe !== timeframe) errors.push(`${idx}: timeframe mismatch`);
    if (!(c.high >= Math.max(c.open, c.close))) errors.push(`${idx}: high < max(open,close)`);
    if (!(c.low <= Math.min(c.open, c.close))) errors.push(`${idx}: low > min(open,close)`);
    if (!(c.high >= c.low)) errors.push(`${idx}: high < low`);
    if (c.volume < 0) errors.push(`${idx}: negative volume`);
    if (i > 0) {
      const prev = candles[i - 1]!;
      if (c.openTime <= prev.openTime) errors.push(`${idx}: openTime not strictly increasing`);
      if (c.openTime % tfMs !== 0) errors.push(`${idx}: openTime not aligned to timeframe`);
      const gap = c.openTime - prev.openTime;
      if (gap !== tfMs) errors.push(`${idx}: unexpected gap ${gap}ms (expected ${tfMs}ms)`);
    }
    if (c.closeTime !== c.openTime + tfMs - 1) {
      errors.push(`${idx}: closeTime ${c.closeTime} != openTime + ${tfMs} - 1`);
    }
    if (!opts.partialLastAllowed && c.closeTime > now) {
      errors.push(`${idx}: candle closes in the future (closeTime ${c.closeTime} > now)`);
    }
  }

  if (errors.length > 0) {
    const message = `invalid candle series ${seriesKey(symbol, timeframe)}: ${errors.slice(0, 20).join("; ")}`;
    const err = new CandleValidationError(message, errors.slice(0, 20));
    throw err;
  }
  return series;
}

/** Type guard used at adapter boundaries. */
export function asCandles(raw: unknown, symbol: Symbol, timeframe: Timeframe): Candle[] {
  const parsed = z.array(CandleSchema).parse(raw);
  return parsed.map((c) => ({ ...c, symbol, timeframe }) as Candle);
}
