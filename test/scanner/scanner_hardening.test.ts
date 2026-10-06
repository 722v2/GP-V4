import { describe, expect, it } from "vitest";
import { Scanner } from "../../src/scanner/Scanner.js";
import { ScannerScheduler } from "../../src/scanner/ScannerScheduler.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { MarketDataProvider } from "../../src/marketdata/MarketDataProvider.js";
import type { CandleSeries } from "../../src/core/types/Candle.js";

const TF = 300_000;

describe("Part B — Scanner & Scheduler Hardening Suite", () => {
  const log = createConsoleLogger("test-scanner-hardening");

  it("1. Scanner enforces single-flight execution (no overlapping scan passes)", async () => {
    let pendingResolvers: (() => void)[] = [];
    const mockProvider: MarketDataProvider = {
      name: "mock",
      fetchCandles: async () => {
        await new Promise<void>((resolve) => pendingResolvers.push(resolve));
        return {
          symbol: "XAUUSD",
          timeframe: "M5",
          candles: [
            { symbol: "XAUUSD", timeframe: "M5", openTime: 1000 * TF, open: 2000, high: 2010, low: 1990, close: 2005, volume: 10, closeTime: 1000 * TF + TF - 1 },
          ],
        };
      },
      fetchQuote: async () => { throw new Error("not impl"); },
    };

    const cache = new CandleCache();
    const scanner = new Scanner(mockProvider, cache, { symbols: ["XAUUSD"], timeframes: ["M5"], limit: 10, scanIntervalMs: 60000 }, log);

    const firstTickPromise = scanner.tick();
    expect(scanner.scanning).toBe(true);

    // Concurrent second tick call while first is in-flight
    const secondTickPromise = scanner.tick();
    const secondResult = await secondTickPromise;

    // Second call is skipped cleanly due to single-flight protection
    expect(secondResult.newBars).toHaveLength(0);
    expect(secondResult.fetched).toBe(0);

    // Resolve first tick
    pendingResolvers.forEach((r) => r());
    const firstResult = await firstTickPromise;
    expect(firstResult.fetched).toBe(1);
    expect(firstResult.newBars).toHaveLength(1);
    expect(scanner.scanning).toBe(false);
  });

  it("2. Scanner collects provider errors without crashing the application", async () => {
    const failingProvider: MarketDataProvider = {
      name: "failing",
      fetchCandles: async () => {
        throw new Error("HTTP 503 Service Unavailable");
      },
      fetchQuote: async () => { throw new Error("not impl"); },
    };

    const cache = new CandleCache();
    const scanner = new Scanner(failingProvider, cache, { symbols: ["XAUUSD"], timeframes: ["M5"], limit: 10, scanIntervalMs: 60000 }, log);

    const result = await scanner.tick();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("HTTP 503");
    expect(scanner.lastScanStats?.errors).toHaveLength(1);
  });

  it("3. ScannerScheduler supports dynamic interval update and clean idempotent shutdown", async () => {
    let passCount = 0;
    const scheduler = new ScannerScheduler({
      timeframes: ["M5"],
      scanIntervalMs: 60000,
      log,
      runPass: async () => {
        passCount += 1;
      },
    });

    await scheduler.start();
    expect(passCount).toBe(1);
    expect(scheduler.running).toBe(true);
    expect(scheduler.stopped).toBe(false);

    // Dynamic interval update
    scheduler.updateInterval(30000);

    // Clean shutdown
    scheduler.stop();
    expect(scheduler.running).toBe(false);
    expect(scheduler.stopped).toBe(true);
  });
});
