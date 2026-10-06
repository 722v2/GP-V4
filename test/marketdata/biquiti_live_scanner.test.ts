import { describe, expect, it } from "vitest";
import { Scanner } from "../../src/scanner/Scanner.js";
import { BiquitiAdapter } from "../../src/marketdata/biquiti/BiquitiAdapter.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";

describe("Real-Time Biquote Scanner Path Verification", () => {
  const logger = createConsoleLogger("scanner-biquote-live");
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

  it("runs scanner tick with real Biquote market data across M1, M5, M15, H1", async () => {
    const cache = new CandleCache();
    const scanner = new Scanner(
      adapter,
      cache,
      {
        symbols: ["XAUUSD"],
        timeframes: ["M1", "M5", "M15", "H1"],
        limit: 10,
        scanIntervalMs: 60_000,
      },
      logger
    );

    const tickResult = await scanner.tick();

    expect(tickResult.fetched).toBe(4); // 4 timeframes fetched
    expect(tickResult.errors).toHaveLength(0); // 0 errors
    expect(tickResult.newBars.length).toBeGreaterThan(0);

    // Verify cache has bars for each timeframe
    expect(cache.get("XAUUSD", "M1").length).toBeGreaterThan(0);
    expect(cache.get("XAUUSD", "M5").length).toBeGreaterThan(0);
    expect(cache.get("XAUUSD", "M15").length).toBeGreaterThan(0);
    expect(cache.get("XAUUSD", "H1").length).toBeGreaterThan(0);
  });
});
