import { describe, expect, it } from "vitest";
import { Scanner } from "../../src/scanner/Scanner.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { FixtureSource } from "../../src/marketdata/replay/FixtureSource.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { CandleSeries, Candle } from "../../src/core/types/Candle.js";
import { AppError, ErrorCode } from "../../src/core/logging/Logger.js";
import type { MarketDataProvider, CandleRequest } from "../../src/marketdata/MarketDataProvider.js";

const log = createConsoleLogger("test");
const TF = 300_000;

function bar(i: number): Candle {
  const o = i * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime: o, open: 2000 + i, high: 2010 + i, low: 1990 + i, close: 2005 + i, volume: 100, closeTime: o + TF - 1 };
}

function series(candles: Candle[]): CandleSeries {
  return { symbol: "XAUUSD", timeframe: "M5", candles };
}

describe("FixtureSource", () => {
  it("serves the most recent N bars of a series", async () => {
    const src = FixtureSource.fromSeries([series([0, 1, 2, 3, 4].map(bar))]);
    const out = await src.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 2 });
    expect(out.candles.map((c) => c.openTime)).toEqual([3 * TF, 4 * TF]);
  });

  it("returns an empty series for unknown keys", async () => {
    const src = FixtureSource.fromSeries([]);
    const out = await src.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 5 });
    expect(out.candles).toHaveLength(0);
  });

  it("validates series structure on fetch", async () => {
    const bad: Candle = { ...bar(1), openTime: 1 };
    const src = FixtureSource.fromSeries([series([bad])]);
    await expect(src.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 5 })).rejects.toThrow(/not aligned|closeTime/);
  });
});

describe("Scanner", () => {
  function makeScanner(provider: MarketDataProvider) {
    const cache = new CandleCache();
    const scanner = new Scanner(
      provider,
      cache,
      { symbols: ["XAUUSD"], timeframes: ["M5"], limit: 100, scanIntervalMs: 1000 },
      log
    );
    return { scanner, cache };
  }

  it("reports new bars on the first tick and none on the second", async () => {
    const { scanner, cache } = makeScanner(FixtureSource.fromSeries([series([0, 1, 2].map(bar))]));
    const first = await scanner.tick();
    expect(first.newBars).toHaveLength(3);
    expect(first.fetched).toBe(1);
    expect(first.errors).toHaveLength(0);
    const second = await scanner.tick();
    expect(second.newBars).toHaveLength(0);
    expect(cache.get("XAUUSD", "M5")).toHaveLength(3);
  });

  it("collects provider errors instead of throwing", async () => {
    const failing: MarketDataProvider = {
      name: "failing",
      fetchCandles: async (_req: CandleRequest) => {
        throw new AppError(ErrorCode.EXTERNAL_UNAVAILABLE, "provider down");
      },
    };
    const { scanner } = makeScanner(failing);
    const result = await scanner.tick();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("provider down");
    expect(result.fetched).toBe(0);
  });
});
