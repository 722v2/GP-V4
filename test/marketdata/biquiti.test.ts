import { describe, expect, it } from "vitest";
import { parseBiquitiCandles, BiquitiAdapter, DEFAULT_FIELD_MAP } from "../../src/marketdata/biquiti/BiquitiAdapter.js";
import { validateCandleSeries, CandleValidationError } from "../../src/marketdata/validation.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import type { Candle, CandleSeries } from "../../src/core/types/Candle.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";

const NOW = 1_700_000_000_000;

function mkCandle(over: Partial<Candle> & Pick<Candle, "openTime" | "open" | "high" | "low" | "close">): Candle {
  return {
    symbol: "XAUUSD",
    timeframe: "M5",
    volume: 100,
    closeTime: over.openTime + 300_000 - 1,
    ...over,
  };
}

function mkSeries(candles: Candle[]): CandleSeries {
  return { symbol: "XAUUSD", timeframe: "M5", candles };
}

describe("parseBiquitiCandles", () => {
  const raw = [
    { openTime: 1_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { openTime: 1_300_000, open: 1.5, high: 2.5, low: 1.2, close: 2.0, volume: 12 },
  ];

  it("maps fields and drops the currently-open bar", () => {
    const now = 1_300_000 + 100_000; // second bar still open
    const out = parseBiquitiCandles(raw, "XAUUSD", "M5", DEFAULT_FIELD_MAP, { now });
    expect(out).toHaveLength(1);
    expect(out[0]!.openTime).toBe(1_000);
    expect(out[0]!.closeTime).toBe(300_999);
  });

  it("sorts ascending regardless of input order", () => {
    const out = parseBiquitiCandles([raw[1]!, raw[0]!], "XAUUSD", "M5", DEFAULT_FIELD_MAP, { now: NOW });
    expect(out.map((c) => c.openTime)).toEqual([1_000, 1_300_000]);
  });

  it("throws a typed contract error on missing field", () => {
    expect(() => parseBiquitiCandles([{ openTime: 1, open: 1 }], "XAUUSD", "M5", DEFAULT_FIELD_MAP, { now: NOW })).toThrow(/missing or non-numeric/);
  });
});

describe("validateCandleSeries", () => {
  const base = mkCandle({ openTime: 300_000, open: 10, high: 12, low: 9, close: 11, closeTime: 599_999 });

  it("accepts a valid series", () => {
    expect(() => validateCandleSeries(mkSeries([base]), { now: NOW })).not.toThrow();
  });

  it("rejects high/low violations", () => {
    const bad = mkCandle({ openTime: 300_000, open: 10, high: 9, low: 9.5, close: 11 });
    expect(() => validateCandleSeries(mkSeries([bad]))).toThrow(CandleValidationError);
  });

  it("rejects unsorted/duplicate/gapped bars", () => {
    const a = mkCandle({ openTime: 300_000, open: 10, high: 12, low: 9, close: 11 });
    const dup = mkCandle({ openTime: 300_000, open: 10, high: 12, low: 9, close: 11 });
    expect(() => validateCandleSeries(mkSeries([a, dup]))).toThrow(/not strictly increasing/);
    const gap = mkCandle({ openTime: 900_000, open: 10, high: 12, low: 9, close: 11 });
    expect(() => validateCandleSeries(mkSeries([a, gap]))).toThrow(/unexpected gap/);
  });

  it("rejects future-closing bars when no lookahead is allowed", () => {
    const future = mkCandle({ openTime: 10_000_000_000_000, open: 10, high: 12, low: 9, close: 11 });
    expect(() => validateCandleSeries(mkSeries([future]), { now: NOW })).toThrow(/closes in the future/);
  });
});

describe("CandleCache", () => {
  it("appends idempotently and ignores stale bars", () => {
    const cache = new CandleCache();
    const a = mkCandle({ openTime: 300_000, open: 10, high: 12, low: 9, close: 11 });
    const b = mkCandle({ openTime: 600_000, open: 11, high: 13, low: 10, close: 12 });
    expect(cache.append(mkSeries([a, b]))).toHaveLength(2);
    expect(cache.append(mkSeries([a, b]))).toHaveLength(0);
    expect(cache.append(mkSeries([b]))).toHaveLength(0);
    expect(cache.get("XAUUSD", "M5")).toHaveLength(2);
    expect(cache.latest("XAUUSD", "M5")!.openTime).toBe(600_000);
  });

  it("viewAsOf enforces temporal isolation", () => {
    const cache = new CandleCache();
    const a = mkCandle({ openTime: 300_000, open: 10, high: 12, low: 9, close: 11, closeTime: 599_999 });
    const b = mkCandle({ openTime: 600_000, open: 11, high: 13, low: 10, close: 12, closeTime: 899_999 });
    cache.append(mkSeries([a, b]));
    expect(cache.viewAsOf("XAUUSD", "M5", 700_000)).toHaveLength(1);
    expect(cache.viewAsOf("XAUUSD", "M5", 899_999)).toHaveLength(2);
  });

  it("trims to maxBars", () => {
    const cache = new CandleCache(2);
    const candles = [0, 1, 2, 3].map((i) =>
      mkCandle({ openTime: 300_000 * (i + 1), open: 10 + i, high: 12, low: 9, close: 11 })
    );
    cache.append(mkSeries(candles));
    expect(cache.get("XAUUSD", "M5")).toHaveLength(2);
    expect(cache.get("XAUUSD", "M5")[0]!.openTime).toBe(900_000);
  });
});

describe("BiquitiAdapter", () => {
  const cfg = {
    baseUrl: "https://api.example.com",
    apiKey: "k1",
    candlesPath: "/v1/candles",
    authHeader: "Authorization",
    symbolMap: { XAUUSD: "GOLD" },
    timeoutMs: 1000,
  };

  it("reports not-configured health when required config is missing", async () => {
    const adapter = new BiquitiAdapter({ ...cfg, baseUrl: "" }, createConsoleLogger("test"));
    expect(adapter.isConfigured()).toBe(false);
    const h = await adapter.health();
    expect(h.ok).toBe(false);
    await expect(adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/not configured/);
  });

  it("fetches, maps, validates and returns normalized series", async () => {
    const now = Date.now();
    const tf = 300_000;
    const open = Math.floor(now / tf) * tf - 2 * tf;
    const raw = [0, 1].map((i) => ({
      openTime: open + i * tf,
      open: 2000 + i,
      high: 2010 + i,
      low: 1990 + i,
      close: 2005 + i,
      volume: 50 + i,
    }));
    let capturedUrl = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ data: raw }), { status: 200 });
    }) as typeof fetch;
    const adapter = new BiquitiAdapter(cfg, createConsoleLogger("test"), fetchImpl);
    const series = await adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 });
    expect(series.symbol).toBe("XAUUSD");
    expect(series.candles).toHaveLength(2);
    expect(series.candles[0]!.volume).toBe(50);
    expect(capturedUrl).toContain("symbol=GOLD");
    expect(capturedUrl).toContain("interval=M5");
  });

  it("surfaces provider HTTP errors as typed errors", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const adapter = new BiquitiAdapter(cfg, createConsoleLogger("test"), fetchImpl);
    await expect(adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/HTTP 500/);
  });
});
