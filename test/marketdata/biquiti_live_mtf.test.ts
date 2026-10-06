import { describe, expect, it } from "vitest";
import { BiquitiAdapter } from "../../src/marketdata/biquiti/BiquitiAdapter.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { buildMtfContext } from "../../src/strategies/mtf/MtfContext.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { IndicatorEngine } from "../../src/strategies/engines/IndicatorEngine.js";
import { ZoneEngine } from "../../src/strategies/engines/ZoneEngine.js";
import { RegimeEngine } from "../../src/strategies/engines/RegimeEngine.js";
import { SessionEngine } from "../../src/strategies/engines/SessionEngine.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { Timeframe } from "../../src/core/types/MarketTypes.js";

describe("Real-Time Biquote MTF Market Data Verification", () => {
  const logger = createConsoleLogger("biquote-mtf-live");
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

  it("performs live HTTP requests for M1, M5, M15, and H1 against Biquote.io", async () => {
    const timeframes: Timeframe[] = ["M1", "M5", "M15", "H1"];
    const cache = new CandleCache();
    const results: Record<string, { latencyMs: number; bars: number; latestTimestamp: number }> = {};

    for (const tf of timeframes) {
      const start = Date.now();
      const series = await adapter.fetchCandles({ symbol: "XAUUSD", timeframe: tf, limit: 10 });
      const latencyMs = Date.now() - start;

      expect(series.symbol).toBe("XAUUSD");
      expect(series.timeframe).toBe(tf);
      expect(series.candles.length).toBeGreaterThan(0);

      const latest = series.candles[series.candles.length - 1]!;
      expect(latest.open).toBeGreaterThan(0);
      expect(latest.high).toBeGreaterThanOrEqual(Math.max(latest.open, latest.close));
      expect(latest.low).toBeLessThanOrEqual(Math.min(latest.open, latest.close));
      expect(latest.close).toBeGreaterThan(0);

      // Verify ordering
      for (let i = 1; i < series.candles.length; i++) {
        expect(series.candles[i]!.openTime).toBeGreaterThan(series.candles[i - 1]!.openTime);
      }

      cache.append(series);
      results[tf] = { latencyMs, bars: series.candles.length, latestTimestamp: latest.openTime };
    }

    // Verify all 4 timeframes populated in cache
    expect(cache.get("XAUUSD", "M1").length).toBeGreaterThan(0);
    expect(cache.get("XAUUSD", "M5").length).toBeGreaterThan(0);
    expect(cache.get("XAUUSD", "M15").length).toBeGreaterThan(0);
    expect(cache.get("XAUUSD", "H1").length).toBeGreaterThan(0);

    // Build real MTF context using M1 decision timestamp T
    const m1Latest = cache.latest("XAUUSD", "M1")!;
    const decisionTimeT = m1Latest.openTime;

    const mtfContext = buildMtfContext(cache, "XAUUSD", decisionTimeT);
    expect(mtfContext.symbol).toBe("XAUUSD");
    expect(mtfContext.asOfTimestamp).toBe(decisionTimeT);

    // Verify temporal isolation (no future bars)
    if (mtfContext.m5) {
      expect(mtfContext.m5.lastClosedTime).toBeLessThanOrEqual(decisionTimeT);
    }
    if (mtfContext.m15) {
      expect(mtfContext.m15.lastClosedTime).toBeLessThanOrEqual(decisionTimeT);
    }
    if (mtfContext.h1) {
      expect(mtfContext.h1.lastClosedTime).toBeLessThanOrEqual(decisionTimeT);
    }

    // Evaluate Confluence with real live market data
    const confluence = new ConfluenceEngine([
      new StructureEngine(),
      new LiquidityEngine(),
      new PriceActionEngine(),
      new IndicatorEngine(),
      new ZoneEngine(),
      new RegimeEngine(),
      new SessionEngine(),
    ]);

    const m1Candles = cache.get("XAUUSD", "M1");
    const confResult = confluence.evaluate({ symbol: "XAUUSD", timeframe: "M1", candles: m1Candles }, mtfContext);

    expect(typeof confResult.score).toBe("number");
    expect(Array.isArray(confResult.evidence)).toBe(true);
  });
});
