import { describe, expect, it } from "vitest";
import type { Candle } from "../../src/core/types/Candle.js";
import { DataQualityValidator } from "../../src/validation/DataQualityValidator.js";
import { WalkForwardEvaluator } from "../../src/validation/WalkForwardEvaluator.js";
import { HistoricalValidationRunner } from "../../src/validation/HistoricalValidationRunner.js";
import { SpreadSlippageModel } from "../../src/execution/TradeLifecycle.js";
import { ReplayRunner } from "../../src/replay/ReplayRunner.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";

const TF_MS = 300_000; // 5 minutes

function makeCandle(i: number, open = 2000, high = 2010, low = 1995, close = 2005, volume = 100, openTimeOffset = 0): Candle {
  const openTime = 1704067200000 + i * TF_MS + openTimeOffset;
  return {
    symbol: "XAUUSD",
    timeframe: "M5",
    openTime,
    closeTime: openTime + TF_MS - 1,
    open,
    high,
    low,
    close,
    volume,
  };
}

const RISK_CONFIG = {
  accountEquity: 10_000,
  perTradePct: 0.5,
  dailyLossCapPct: 3,
  weeklyLossCapPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 2,
  netExposureMax: 1.0,
  marginCeilingPct: 50,
};

const SPREAD_MODEL = new SpreadSlippageModel(0.35, 0.2, 250);

describe("P1-5: Data Quality Validation", () => {
  it("validates a clean, chronological candle series", () => {
    const candles = [makeCandle(0), makeCandle(1), makeCandle(2), makeCandle(3)];
    const report = DataQualityValidator.validate(candles);
    expect(report.valid).toBe(true);
    expect(report.totalCandles).toBe(4);
    expect(report.metrics.duplicateCount).toBe(0);
    expect(report.metrics.outOfOrderCount).toBe(0);
    expect(report.metrics.invalidRangeCount).toBe(0);
  });

  it("detects duplicate timestamps", () => {
    const candles = [makeCandle(0), makeCandle(1), makeCandle(1), makeCandle(2)];
    const report = DataQualityValidator.validate(candles);
    expect(report.valid).toBe(false);
    expect(report.metrics.duplicateCount).toBe(1);
  });

  it("detects out-of-order timestamps", () => {
    const candles = [makeCandle(0), makeCandle(3), makeCandle(1), makeCandle(4)];
    const report = DataQualityValidator.validate(candles);
    expect(report.valid).toBe(false);
    expect(report.metrics.outOfOrderCount).toBe(1);
  });

  it("detects malformed candles (high < open/close or low > open/close)", () => {
    const badCandles = [
      makeCandle(0),
      makeCandle(1, 2000, 1990, 1995, 2005), // High (1990) < max(O,C) (2005)
    ];
    const report = DataQualityValidator.validate(badCandles);
    expect(report.valid).toBe(false);
    expect(report.metrics.invalidRangeCount).toBe(1);
  });

  it("distinguishes legitimate weekend gaps from unexpected data gaps", () => {
    const normal1 = makeCandle(0);
    const normal2 = makeCandle(1);
    // 48 hour weekend gap (48 * 3600 * 1000)
    const weekendCandle = makeCandle(2, 2000, 2010, 1995, 2005, 100, 48 * 3600 * 1000);
    // 3 hour unexpected mid-week gap
    const unexpectedGapCandle = makeCandle(3, 2000, 2010, 1995, 2005, 100, 48 * 3600 * 1000 + 3 * 3600 * 1000);

    const report = DataQualityValidator.validate([normal1, normal2, weekendCandle, unexpectedGapCandle]);
    expect(report.metrics.expectedSessionGapsCount).toBe(1);
    expect(report.metrics.unexpectedGapsCount).toBe(1);
    // Structural integrity is valid if there are no duplicate/malformed/out-of-order candles
    expect(report.valid).toBe(true);
  });
});

describe("P1-5: Walk-Forward Validation", () => {
  it("enforces temporal separation between in-sample and out-of-sample windows", async () => {
    const candles = Array.from({ length: 40 }, (_, i) => makeCandle(i));
    const report = await WalkForwardEvaluator.evaluate(candles, {
      inSampleBars: 20,
      outOfSampleBars: 10,
      stepBars: 10,
      riskConfig: RISK_CONFIG,
      spreadModel: SPREAD_MODEL,
    });

    expect(report.totalWindows).toBe(2);
    for (const w of report.windows) {
      // In-sample end must strictly precede Out-of-sample start
      expect(w.inSampleRange.end).toBeLessThan(w.outOfSampleRange.start);
    }
  });
});

describe("P1-5: Replay & Historical Validation Report", () => {
  it("generates a complete historical validation report and detects missing real broker data", async () => {
    const candles = Array.from({ length: 25 }, (_, i) => makeCandle(i));
    const report = await HistoricalValidationRunner.validate(candles, {
      riskConfig: RISK_CONFIG,
      spreadModel: SPREAD_MODEL,
      isRealBrokerData: false,
    });

    expect(report.status).toBe("PARTIAL_PENDING_DATA");
    expect(report.summary).toContain("pending actual broker data");
    expect(report.dataQuality.valid).toBe(true);
    expect(report.baselineComparison.unfiltered).toBeDefined();
    expect(report.baselineComparison.filtered).toBeDefined();
    expect(report.walkForward.totalWindows).toBeGreaterThanOrEqual(1);
    expect(report.aiComparison.status).toBe("PENDING_RECORDED_DATA");
  });

  it("produces deterministic same-input results", async () => {
    const candles = Array.from({ length: 20 }, (_, i) => makeCandle(i));
    const report1 = await HistoricalValidationRunner.validate(candles, {
      riskConfig: RISK_CONFIG,
      spreadModel: SPREAD_MODEL,
    });
    const report2 = await HistoricalValidationRunner.validate(candles, {
      riskConfig: RISK_CONFIG,
      spreadModel: SPREAD_MODEL,
    });

    expect(report1.dataQuality.totalCandles).toBe(report2.dataQuality.totalCandles);
    expect(report1.baselineComparison.filtered.metrics.netProfit).toBe(report2.baselineComparison.filtered.metrics.netProfit);
    expect(report1.walkForward.totalWindows).toBe(report2.walkForward.totalWindows);
  });
});
