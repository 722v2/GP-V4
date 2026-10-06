import { describe, expect, it } from "vitest";
import { BiquitiAdapter } from "../../src/marketdata/biquiti/BiquitiAdapter.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";

describe("Biquote.io Live Integration Check", () => {
  const logger = createConsoleLogger("test-biquote-live");

  it("fetches live XAUUSD M5 candles from real Biquote.io endpoint", async () => {
    const adapter = new BiquitiAdapter(
      {
        baseUrl: "https://biquote.io",
        apiKey: "",
        candlesPath: "/api/{symbol}/ohlc",
        authHeader: "Authorization",
        symbolMap: { XAUUSD: "XAUUSD" },
        timeoutMs: 10_000,
      },
      logger
    );

    expect(adapter.isConfigured()).toBe(true);

    const series = await adapter.fetchCandles({
      symbol: "XAUUSD",
      timeframe: "M5",
      limit: 5,
    });

    expect(series.symbol).toBe("XAUUSD");
    expect(series.timeframe).toBe("M5");
    expect(series.candles.length).toBeGreaterThan(0);

    const latest = series.candles[series.candles.length - 1]!;
    expect(latest.open).toBeGreaterThan(0);
    expect(latest.high).toBeGreaterThanOrEqual(Math.max(latest.open, latest.close));
    expect(latest.low).toBeLessThanOrEqual(Math.min(latest.open, latest.close));
    expect(latest.close).toBeGreaterThan(0);
  });
});
