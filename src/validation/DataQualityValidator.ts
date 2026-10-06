import type { Candle } from "../core/types/Candle.js";
import type { Symbol, Timeframe } from "../core/types/MarketTypes.js";
import { TIMEFRAME_MS, isTimeframe } from "../core/types/MarketTypes.js";
import type { DataQualityReport, DataQualityIssue } from "./ValidationContracts.js";

export interface DataQualityOptions {
  readonly expectedSymbol?: Symbol | string;
  readonly expectedTimeframe?: Timeframe | string;
}

export class DataQualityValidator {
  static validate(
    candles: readonly Candle[],
    opts: DataQualityOptions = {}
  ): DataQualityReport {
    let duplicateCount = 0;
    let invalidRangeCount = 0;
    let invalidValueCount = 0;
    let unexpectedGapsCount = 0;
    let expectedSessionGapsCount = 0;
    let outOfOrderCount = 0;
    let symbolMismatches = 0;
    let timeframeMismatches = 0;

    const issues: DataQualityIssue[] = [];

    if (candles.length === 0) {
      return {
        valid: false,
        totalCandles: 0,
        metrics: {
          duplicateCount: 0,
          invalidRangeCount: 0,
          invalidValueCount: 0,
          unexpectedGapsCount: 0,
          expectedSessionGapsCount: 0,
          outOfOrderCount: 0,
          symbolMismatches: 0,
          timeframeMismatches: 0,
        },
        issues: [{ severity: "ERROR", message: "Candle dataset is completely empty" }],
      };
    }

    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    const symbol = opts.expectedSymbol ?? first.symbol;
    const timeframe = opts.expectedTimeframe ?? first.timeframe;

    const tfMs = isTimeframe(timeframe) ? TIMEFRAME_MS[timeframe as Timeframe] : 300_000;
    const seenTimes = new Set<number>();

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      const idx = `candle[${i}]`;

      // 1. Symbol & Timeframe checks
      if (opts.expectedSymbol && c.symbol !== opts.expectedSymbol) {
        symbolMismatches += 1;
        issues.push({
          severity: "ERROR",
          message: `${idx}: symbol mismatch (${c.symbol} != ${opts.expectedSymbol})`,
          index: i,
          timestamp: c.openTime,
        });
      }

      if (opts.expectedTimeframe && c.timeframe !== opts.expectedTimeframe) {
        timeframeMismatches += 1;
        issues.push({
          severity: "ERROR",
          message: `${idx}: timeframe mismatch (${c.timeframe} != ${opts.expectedTimeframe})`,
          index: i,
          timestamp: c.openTime,
        });
      }

      // 2. Numeric and Range Validity
      if (
        !Number.isFinite(c.open) ||
        !Number.isFinite(c.high) ||
        !Number.isFinite(c.low) ||
        !Number.isFinite(c.close) ||
        !Number.isFinite(c.volume) ||
        !Number.isFinite(c.openTime) ||
        !Number.isFinite(c.closeTime) ||
        c.volume < 0
      ) {
        invalidValueCount += 1;
        issues.push({
          severity: "ERROR",
          message: `${idx}: non-finite or negative value`,
          index: i,
          timestamp: c.openTime,
        });
      }

      const maxOC = Math.max(c.open, c.close);
      const minOC = Math.min(c.open, c.close);

      if (c.high < maxOC || c.low > minOC || c.high < c.low) {
        invalidRangeCount += 1;
        issues.push({
          severity: "ERROR",
          message: `${idx}: invalid OHLC range (H=${c.high}, L=${c.low}, O=${c.open}, C=${c.close})`,
          index: i,
          timestamp: c.openTime,
        });
      }

      // 3. Duplicate timestamp check
      if (seenTimes.has(c.openTime)) {
        duplicateCount += 1;
        issues.push({
          severity: "ERROR",
          message: `${idx}: duplicate timestamp ${c.openTime}`,
          index: i,
          timestamp: c.openTime,
        });
      } else {
        seenTimes.add(c.openTime);
      }

      // 4. Chronological ordering & Gap Analysis
      if (i > 0) {
        const prev = candles[i - 1]!;
        if (c.openTime < prev.openTime) {
          outOfOrderCount += 1;
          issues.push({
            severity: "ERROR",
            message: `${idx}: timestamp out of chronological order (${c.openTime} < ${prev.openTime})`,
            index: i,
            timestamp: c.openTime,
          });
        } else if (c.openTime === prev.openTime) {
          // Handled as duplicate above
        } else {
          const gap = c.openTime - prev.openTime;
          if (gap > tfMs) {
            // Is it a weekend gap (e.g. Friday ~21:00 UTC to Sunday ~21:00 UTC => ~48-72h)
            // or daily session break (~1 hour for metals/commodities)?
            const hours = gap / (1000 * 3600);
            const isWeekend = hours >= 40 && hours <= 80;
            const isDailySessionBreak = hours >= 0.75 && hours <= 2.5;

            if (isWeekend || isDailySessionBreak) {
              expectedSessionGapsCount += 1;
              issues.push({
                severity: "INFO",
                message: `${idx}: expected session/weekend gap of ${hours.toFixed(1)}h`,
                index: i,
                timestamp: c.openTime,
              });
            } else {
              unexpectedGapsCount += 1;
              issues.push({
                severity: "WARNING",
                message: `${idx}: unexpected gap of ${gap / 1000}s (expected ${tfMs / 1000}s)`,
                index: i,
                timestamp: c.openTime,
              });
            }
          }
        }
      }
    }

    const valid =
      duplicateCount === 0 &&
      invalidRangeCount === 0 &&
      invalidValueCount === 0 &&
      outOfOrderCount === 0 &&
      symbolMismatches === 0 &&
      timeframeMismatches === 0;

    return {
      valid,
      totalCandles: candles.length,
      symbol,
      timeframe,
      startTime: first.openTime,
      endTime: last.closeTime,
      metrics: {
        duplicateCount,
        invalidRangeCount,
        invalidValueCount,
        unexpectedGapsCount,
        expectedSessionGapsCount,
        outOfOrderCount,
        symbolMismatches,
        timeframeMismatches,
      },
      issues: issues.slice(0, 100), // capped for report sizing
    };
  }
}
