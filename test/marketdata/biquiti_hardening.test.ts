import { describe, expect, it } from "vitest";
import { BiquitiAdapter, DEFAULT_FIELD_MAP } from "../../src/marketdata/biquiti/BiquitiAdapter.js";
import { validateCandleSeries, CandleValidationError } from "../../src/marketdata/validation.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { Candle, CandleSeries } from "../../src/core/types/Candle.js";

const TF = 300_000;
const NOW = 1_700_000_000_000;

function bar(idx: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  const openTime = idx * TF;
  return {
    symbol: "XAUUSD",
    timeframe: "M5",
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime: openTime + TF - 1,
  };
}

function mkSeries(candles: Candle[]): CandleSeries {
  return { symbol: "XAUUSD", timeframe: "M5", candles };
}

describe("Part A — Market Data Hardening Suite", () => {
  const log = createConsoleLogger("test-md-hardening");

  it("1. Rejects non-positive prices (open <= 0, high <= 0, low <= 0, close <= 0)", () => {
    const zeroPrice = bar(1, 0, 10, 0, 5);
    expect(() => validateCandleSeries(mkSeries([zeroPrice]), { now: NOW })).toThrow(CandleValidationError);

    const negativePrice = bar(1, 10, 12, -1, 11);
    expect(() => validateCandleSeries(mkSeries([negativePrice]), { now: NOW })).toThrow(/non-positive price/);
  });

  it("2. Validates OHLC consistency (high >= max(open,close), low <= min(open,close), high >= low)", () => {
    const invalidHigh = bar(1, 2000, 1990, 1980, 1995); // high < open
    expect(() => validateCandleSeries(mkSeries([invalidHigh]), { now: NOW })).toThrow(/high < max\(open,close\)/);

    const invalidLow = bar(1, 2000, 2010, 2005, 2002); // low > close
    expect(() => validateCandleSeries(mkSeries([invalidLow]), { now: NOW })).toThrow(/low > min\(open,close\)/);
  });

  it("3. Rejects duplicate timestamps and out-of-order candles", () => {
    const b1 = bar(1, 2000, 2010, 1990, 2005);
    const b1Dup = bar(1, 2000, 2010, 1990, 2005);
    expect(() => validateCandleSeries(mkSeries([b1, b1Dup]), { now: NOW })).toThrow(/openTime not strictly increasing/);

    const b2 = bar(2, 2005, 2015, 1995, 2010);
    const b0 = bar(0, 1995, 2005, 1990, 2000);
    expect(() => validateCandleSeries(mkSeries([b2, b0]), { now: NOW })).toThrow(/openTime not strictly increasing/);
  });

  it("4. Rejects symbol and timeframe mismatches", () => {
    const b1 = bar(1, 2000, 2010, 1990, 2005);
    const wrongSymbol: Candle = { ...b1, symbol: "EURUSD" as unknown as "XAUUSD" };
    expect(() => validateCandleSeries(mkSeries([wrongSymbol]), { now: NOW })).toThrow(/symbol mismatch/);

    const wrongTf: Candle = { ...b1, timeframe: "H1" };
    expect(() => validateCandleSeries(mkSeries([wrongTf]), { now: NOW })).toThrow(/timeframe mismatch/);
  });

  it("5. BiquitiAdapter strictly fails safely without fabricating candles when not configured", async () => {
    const unconfigured = new BiquitiAdapter(
      { baseUrl: "", apiKey: "", candlesPath: "/v1/candles", authHeader: "Authorization", symbolMap: {}, timeoutMs: 1000 },
      log
    );
    expect(unconfigured.isConfigured()).toBe(false);
    const health = await unconfigured.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain("not configured");

    await expect(unconfigured.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/not configured/);
  });
});
