import { describe, expect, it } from "vitest";
import {
  parseBiquitiCandles,
  BiquitiAdapter,
  DEFAULT_FIELD_MAP,
  BIQUOTE_TIMEFRAME_MAP,
} from "../../src/marketdata/biquiti/BiquitiAdapter.js";
import { validateCandleSeries, CandleValidationError } from "../../src/marketdata/validation.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import type { Candle, CandleSeries } from "../../src/core/types/Candle.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";

const NOW = 1_762_443_000_000;

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

describe("parseBiquitiCandles (Biquote.io parser)", () => {
  const rawBiquote = [
    {
      openTime: "2026-10-06T15:00:00Z",
      open: 4156.501,
      high: 4163.618,
      low: 4155.783,
      close: 4160.845,
      volume: 0,
      tickVolume: 964,
      isOpen: false,
    },
    {
      openTime: "2026-10-06T15:05:00Z",
      open: 4160.948,
      high: 4163.997,
      low: 4159.252,
      close: 4160.527,
      volume: 0,
      tickVolume: 826,
      isOpen: false,
    },
    {
      openTime: "2026-10-06T15:10:00Z",
      open: 4160.578,
      high: 4162.78,
      low: 4160.45,
      close: 4162.477,
      volume: 0,
      tickVolume: 173,
      isOpen: true, // Currently-open bar
    },
  ];

  it("parses Biquote ISO 8601 openTime, maps tickVolume when volume is 0, and drops isOpen: true", () => {
    const now = Date.parse("2026-10-06T15:12:00Z");
    const out = parseBiquitiCandles(rawBiquote, "XAUUSD", "M5", DEFAULT_FIELD_MAP, { now });

    expect(out).toHaveLength(2); // Drops isOpen: true bar
    expect(out[0]!.openTime).toBe(Date.parse("2026-10-06T15:00:00Z"));
    expect(out[0]!.closeTime).toBe(Date.parse("2026-10-06T15:00:00Z") + 300_000 - 1);
    expect(out[0]!.open).toBe(4156.501);
    expect(out[0]!.close).toBe(4160.845);
    expect(out[0]!.volume).toBe(964); // Fallback to tickVolume
    expect(out[1]!.openTime).toBe(Date.parse("2026-10-06T15:05:00Z"));
  });

  it("sorts candles ascending (oldest first) regardless of input order", () => {
    const now = Date.parse("2026-10-06T15:12:00Z");
    const reversed = [rawBiquote[1]!, rawBiquote[0]!];
    const out = parseBiquitiCandles(reversed, "XAUUSD", "M5", DEFAULT_FIELD_MAP, { now });

    expect(out.map((c) => c.openTime)).toEqual([
      Date.parse("2026-10-06T15:00:00Z"),
      Date.parse("2026-10-06T15:05:00Z"),
    ]);
  });

  it("throws a typed contract error on missing/invalid numeric fields", () => {
    const testNow = Date.parse("2026-10-06T16:00:00Z");
    expect(() =>
      parseBiquitiCandles([{ openTime: "2026-10-06T15:00:00Z", open: "invalid" }], "XAUUSD", "M5", DEFAULT_FIELD_MAP, { now: testNow })
    ).toThrow(/missing or non-numeric/);
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

describe("BiquitiAdapter (Biquote.io API Integration)", () => {
  const cfg = {
    baseUrl: "https://biquote.io",
    apiKey: "",
    candlesPath: "/api/{symbol}/ohlc",
    authHeader: "Authorization",
    symbolMap: { XAUUSD: "XAUUSD" },
    timeoutMs: 1000,
  };

  const logger = createConsoleLogger("test-biquote");

  it("timeframe mapping maps M5 -> 5m, M15 -> 15m, H1 -> 1h", () => {
    expect(BIQUOTE_TIMEFRAME_MAP.M5).toBe("5m");
    expect(BIQUOTE_TIMEFRAME_MAP.M15).toBe("15m");
    expect(BIQUOTE_TIMEFRAME_MAP.H1).toBe("1h");
  });

  it("reports not-configured health when baseUrl is missing", async () => {
    const adapter = new BiquitiAdapter({ ...cfg, baseUrl: "" }, logger);
    expect(adapter.isConfigured()).toBe(false);
    const h = await adapter.health();
    expect(h.ok).toBe(false);
    await expect(adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/not configured/);
  });

  it("constructs correct M5 request URL: /api/XAUUSD/ohlc?interval=5m&limit=10", async () => {
    let capturedUrl = "";
    const now = Date.parse("2026-10-06T15:15:00Z");

    const responseBody = {
      symbol: "XAUUSD",
      interval: "5m",
      bars: [
        { openTime: "2026-10-06T15:00:00Z", open: 2000, high: 2010, low: 1990, close: 2005, volume: 0, tickVolume: 50, isOpen: false },
        { openTime: "2026-10-06T15:05:00Z", open: 2005, high: 2015, low: 1995, close: 2010, volume: 0, tickVolume: 60, isOpen: false },
      ],
    };

    const fetchImpl = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(responseBody), { status: 200 });
    }) as typeof fetch;

    const adapter = new BiquitiAdapter(cfg, logger, fetchImpl);
    const series = await adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 });

    expect(capturedUrl).toBe("https://biquote.io/api/XAUUSD/ohlc?interval=5m&limit=10");
    expect(series.symbol).toBe("XAUUSD");
    expect(series.timeframe).toBe("M5");
    expect(series.candles).toHaveLength(2);
  });

  it("constructs correct M15 request URL: /api/XAUUSD/ohlc?interval=15m&limit=5", async () => {
    let capturedUrl = "";
    const responseBody = {
      symbol: "XAUUSD",
      interval: "15m",
      bars: [
        { openTime: "2026-10-06T14:30:00Z", open: 2000, high: 2010, low: 1990, close: 2005, volume: 0, tickVolume: 150, isOpen: false },
      ],
    };

    const fetchImpl = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(responseBody), { status: 200 });
    }) as typeof fetch;

    const adapter = new BiquitiAdapter(cfg, logger, fetchImpl);
    const series = await adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M15", limit: 5 });

    expect(capturedUrl).toBe("https://biquote.io/api/XAUUSD/ohlc?interval=15m&limit=5");
    expect(series.timeframe).toBe("M15");
  });

  it("constructs correct H1 request URL: /api/XAUUSD/ohlc?interval=1h&limit=24", async () => {
    let capturedUrl = "";
    const responseBody = {
      symbol: "XAUUSD",
      interval: "1h",
      bars: [
        { openTime: "2026-10-06T13:00:00Z", open: 2000, high: 2010, low: 1990, close: 2005, volume: 0, tickVolume: 500, isOpen: false },
      ],
    };

    const fetchImpl = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(responseBody), { status: 200 });
    }) as typeof fetch;

    const adapter = new BiquitiAdapter(cfg, logger, fetchImpl);
    const series = await adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "H1", limit: 24 });

    expect(capturedUrl).toBe("https://biquote.io/api/XAUUSD/ohlc?interval=1h&limit=24");
    expect(series.timeframe).toBe("H1");
  });

  it("handles empty response ({ bars: [] })", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ bars: [] }), { status: 200 })) as typeof fetch;
    const adapter = new BiquitiAdapter(cfg, logger, fetchImpl);
    await expect(adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/series is empty/);
  });

  it("handles malformed JSON / missing bar array response", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ status: "ok", result: "none" }), { status: 200 })) as typeof fetch;
    const adapter = new BiquitiAdapter(cfg, logger, fetchImpl);
    await expect(adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/could not locate candle array/);
  });

  it("surfaces provider HTTP errors as typed errors", async () => {
    const fetchImpl = (async () => new Response("Internal Server Error", { status: 500 })) as typeof fetch;
    const adapter = new BiquitiAdapter(cfg, logger, fetchImpl);
    await expect(adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/HTTP 500/);
  });

  it("handles timeout gracefully when request takes longer than timeoutMs", async () => {
    const slowFetch = (async (_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }) as typeof fetch;

    const shortCfg = { ...cfg, timeoutMs: 50 };
    const adapter = new BiquitiAdapter(shortCfg, logger, slowFetch);
    await expect(adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 })).rejects.toThrow(/timed out/);
  });

  it("filters out currently-open candles and prevents lookahead", async () => {
    const now = Date.parse("2026-10-06T15:08:00Z");
    const responseBody = {
      bars: [
        { openTime: "2026-10-06T15:00:00Z", open: 2000, high: 2010, low: 1990, close: 2005, volume: 10, isOpen: false },
        { openTime: "2026-10-06T15:05:00Z", open: 2005, high: 2015, low: 1995, close: 2010, volume: 12, isOpen: true }, // open!
      ],
    };

    const fetchImpl = (async () => new Response(JSON.stringify(responseBody), { status: 200 })) as typeof fetch;
    const adapter = new BiquitiAdapter(cfg, logger, fetchImpl);
    const series = await adapter.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 10 });

    expect(series.candles).toHaveLength(1);
    expect(series.candles[0]!.openTime).toBe(Date.parse("2026-10-06T15:00:00Z"));
  });
});
