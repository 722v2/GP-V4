import { describe, expect, it } from "vitest";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { buildMtfContext } from "../../src/strategies/mtf/MtfContext.js";
import { ConfluenceEngine, DEFAULT_CONFLUENCE_CONFIG } from "../../src/strategies/ConfluenceEngine.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { ContextBuilder } from "../../src/ai/ContextBuilder.js";
import { TradingPipeline } from "../../src/pipeline/TradingPipeline.js";
import { StrongCandleStrategy } from "../../src/strategies/StrongCandleStrategy.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { Candle, CandleSeries } from "../../src/core/types/Candle.js";
import type { Symbol, Timeframe } from "../../src/core/types/MarketTypes.js";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/config/RuntimeConfigStore.js";

const log = createConsoleLogger("test-mtf");

function mkCandle(
  symbol: Symbol,
  timeframe: Timeframe,
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100
): Candle {
  const tfMs: Record<string, number> = { M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000 };
  const step = tfMs[timeframe] ?? 60_000;
  return {
    symbol,
    timeframe,
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime: openTime + step - 1,
  };
}

describe("Multi-Timeframe (MTF) Strategy & Context Suite", () => {
  it("1 & 2. M1 is primary default in runtime config, M5/M15/H1 are included", () => {
    expect(DEFAULT_RUNTIME_CONFIG.timeframes).toEqual(["M1", "M5", "M15", "H1"]);
  });

  it("3. Higher timeframes (M5/M15/H1) cannot independently create production entry signals", async () => {
    const bus = new EventBus();
    const cache = new CandleCache();
    const confluence = new ConfluenceEngine([new StructureEngine()]);
    const strategy = new StrongCandleStrategy();
    const setupStore = new SetupStore();

    const pipeline = new TradingPipeline({
      bus,
      cache,
      confluence,
      strategy,
      setupStore,
      ai: { analyze: async () => ({ ok: false, error: "disabled" }) } as any,
      riskConfig: { accountEquity: 10000 } as any,
      riskEnv: () => ({ equity: 10000, state: {} as any, killSwitch: 0 as any, mode: "ANALYSIS_ONLY" }),
      repo: { saveSetup: async () => ({ accepted: true }) } as any,
      telegram: {} as any,
      mode: "ANALYSIS_ONLY",
      log,
    });

    // Append M1 and M5 candles
    cache.append({ symbol: "XAUUSD", timeframe: "M1", candles: [mkCandle("XAUUSD", "M1", 60_000, 2000, 2010, 1990, 2005)] });
    const m5Bars = [1, 2, 3, 4, 5, 6].map((i) => mkCandle("XAUUSD", "M5", i * 300_000, 2000, 2010, 1990, 2005));
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: m5Bars });

    const resultM5 = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(resultM5.action.kind).toBe("NO_SETUP");
    expect(resultM5.reasons[0]).toContain("higher timeframe bar processed for MTF context only");
  });

  it("4, 5, 6. M1 receives M5, M15, and H1 higher-timeframe context", () => {
    const cache = new CandleCache();
    const baseTime = 1_700_000_000_000;

    // Create swing structure: higher high and higher low
    const prices = [2000, 2005, 2002, 2012, 2008, 2018, 2015, 2025, 2020, 2030];
    const m5Candles = prices.map((p, i) =>
      mkCandle("XAUUSD", "M5", baseTime + i * 300_000, p - 1, p + 2, p - 2, p)
    );
    const m15Candles = prices.map((p, i) =>
      mkCandle("XAUUSD", "M15", baseTime + i * 900_000, p - 1, p + 2, p - 2, p)
    );
    const h1Candles = prices.map((p, i) =>
      mkCandle("XAUUSD", "H1", baseTime + i * 3_600_000, p - 1, p + 2, p - 2, p)
    );

    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: m5Candles });
    cache.append({ symbol: "XAUUSD", timeframe: "M15", candles: m15Candles });
    cache.append({ symbol: "XAUUSD", timeframe: "H1", candles: h1Candles });

    const mtf = buildMtfContext(cache, "XAUUSD", baseTime + 10 * 3_600_000);

    expect(mtf.m5).toBeDefined();
    expect(mtf.m15).toBeDefined();
    expect(mtf.h1).toBeDefined();
  });

  it("7. Temporal isolation: higher-timeframe context NEVER sees future candles", () => {
    const cache = new CandleCache();
    const t0 = 1_700_000_000_000;

    // 5 old M5 candles (closeTime <= t0 + 1,500,000)
    const oldBars = [0, 1, 2, 3, 4].map((i) =>
      mkCandle("XAUUSD", "M5", t0 + i * 300_000, 2000 + i, 2005 + i, 1995 + i, 2002 + i)
    );
    // 5 future M5 candles (closeTime > t0 + 1,500,000)
    const futureBars = [5, 6, 7, 8, 9].map((i) =>
      mkCandle("XAUUSD", "M5", t0 + i * 300_000, 2010 + i, 2020 + i, 2005 + i, 2018 + i)
    );

    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles: [...oldBars, ...futureBars] });

    // Query context at timestamp t0 + 1,500,000 (M1 bar timestamp)
    const mtf = buildMtfContext(cache, "XAUUSD", t0 + 1_500_000);

    // Only oldBars had closeTime <= t0 + 1,500,000
    expect(mtf.m5?.barCount).toBe(5);
    expect(mtf.m5?.lastClosedTime).toBe(t0 + 4 * 300_000);
  });

  it("8. MTF context handles missing higher-timeframe data safely without throwing", () => {
    const cache = new CandleCache();
    // Cache is empty
    const mtf = buildMtfContext(cache, "XAUUSD", Date.now());

    expect(mtf.m5).toBeUndefined();
    expect(mtf.m15).toBeUndefined();
    expect(mtf.h1).toBeUndefined();

    const confluence = new ConfluenceEngine([new StructureEngine()]);
    const ctx = { symbol: "XAUUSD" as Symbol, timeframe: "M1" as Timeframe, candles: [] };

    expect(() => confluence.evaluate(ctx, mtf)).not.toThrow();
  });

  it("9 & 10. MTF handles conflicting HTF directions as graded evidence without signal starvation", () => {
    const confluence = new ConfluenceEngine([new StructureEngine(), new PriceActionEngine()]);

    const m1Candles = Array.from({ length: 10 }, (_, i) =>
      mkCandle("XAUUSD", "M1", 1000 + i * 60_000, 2000 + i, 2010 + i, 1990 + i, 2008 + i)
    );

    const mtfConflicting = {
      symbol: "XAUUSD" as Symbol,
      asOfTimestamp: 1000 + 10 * 60_000,
      primaryTimeframe: "M1" as const,
      m5: { timeframe: "M5" as Timeframe, barCount: 10, lastClosedTime: 1000, lastClose: 2008, trend: "BULLISH" as const, score: 0.5, regime: "normal", rationale: "M5 bullish" },
      m15: { timeframe: "M15" as Timeframe, barCount: 10, lastClosedTime: 1000, lastClose: 2008, trend: "BEARISH" as const, score: -0.4, regime: "normal", rationale: "M15 bearish" },
    };

    const result = confluence.evaluate({ symbol: "XAUUSD", timeframe: "M1", candles: m1Candles }, mtfConflicting);

    // Conflicting M15 (-0.3) reduces score but strong M1 + M5 still allows directional bias if score clears threshold
    expect(result.evidence.some((e) => e.source === "mtf-m5")).toBe(true);
    expect(result.evidence.some((e) => e.source === "mtf-m15")).toBe(true);
    expect(typeof result.score).toBe("number");
  });

  it("11. AI ContextBuilder receives structured MTF context", () => {
    const builder = new ContextBuilder();
    const m1Candles = [mkCandle("XAUUSD", "M1", 1000, 2000, 2005, 1995, 2002)];

    const confluence = {
      score: 0.8,
      direction: "LONG" as const,
      evidence: [],
      levels: [],
      perEngine: [],
      mtfContext: {
        symbol: "XAUUSD" as Symbol,
        asOfTimestamp: 1000,
        primaryTimeframe: "M1" as const,
        m5: { timeframe: "M5" as Timeframe, barCount: 10, lastClosedTime: 1000, lastClose: 2002, trend: "BULLISH" as const, score: 0.6, regime: "trending", rationale: "M5 bullish" },
        m15: { timeframe: "M15" as Timeframe, barCount: 10, lastClosedTime: 1000, lastClose: 2002, trend: "BULLISH" as const, score: 0.4, regime: "trending", rationale: "M15 bullish" },
      },
    };

    const setup = {
      id: "sc:XAUUSD:M1:1000",
      strategyId: "strong-candle",
      symbol: "XAUUSD" as Symbol,
      timeframe: "M1" as Timeframe,
      direction: "LONG" as const,
      barOpenTime: 1000,
      createdAt: 1000,
      state: "NEW" as const,
      entry: 2002,
      stopLoss: 1995,
      takeProfit1: 2009,
      takeProfit2: 2016,
      invalidationPrice: 1995,
      rationale: "M1 trigger",
      evidence: [],
    };

    const prompt = builder.buildSetupPrompt(
      { symbol: "XAUUSD", timeframe: "M1", candles: m1Candles },
      confluence as any,
      setup as any,
      10000,
      "ANALYSIS_ONLY"
    );

    expect(prompt.user).toContain("PRIMARY SIGNAL TIMEFRAME: M1");
    expect(prompt.user).toContain("HIGHER-TIMEFRAME CONTEXT (M5, M15, H1)");
    expect(prompt.user).toContain("M5 Context: BULLISH trend");
    expect(prompt.user).toContain("M15 Context: BULLISH trend");
  });
});
