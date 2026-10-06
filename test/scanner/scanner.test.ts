import { describe, expect, it, vi } from "vitest";
import { Scanner } from "../../src/scanner/Scanner.js";
import { ScannerScheduler, calculateMsToNextCandleClose } from "../../src/scanner/ScannerScheduler.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { FixtureSource } from "../../src/marketdata/replay/FixtureSource.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { CandleSeries, Candle } from "../../src/core/types/Candle.js";
import { AppError, ErrorCode } from "../../src/core/logging/Logger.js";
import type { MarketDataProvider, CandleRequest } from "../../src/marketdata/MarketDataProvider.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { StrongCandleStrategy } from "../../src/strategies/StrongCandleStrategy.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { TradingPipeline } from "../../src/pipeline/TradingPipeline.js";
import { NullRepository } from "../../src/persistence/Persistence.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import { IdempotencyGuard } from "../../src/safety/IdempotencyGuard.js";
import { collectClosedBarEvents } from "../../src/pipeline/barEvents.js";

import { DEFAULT_RISK_STATE } from "../../src/risk/RiskEngine.js";

const log = createConsoleLogger("test");
const TF = 300_000;

function bar(i: number): Candle {
  const o = i * TF;
  return {
    symbol: "XAUUSD",
    timeframe: "M5",
    openTime: o,
    open: 2000 + i,
    high: 2010 + i,
    low: 1990 + i,
    close: 2005 + i,
    volume: 100,
    closeTime: o + TF - 1,
  };
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
    await expect(src.fetchCandles({ symbol: "XAUUSD", timeframe: "M5", limit: 5 })).rejects.toThrow(
      /not aligned|closeTime/
    );
  });
});

describe("Scanner — P2-13 Reliability & Single-Flight", () => {
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

  it("enforces single-flight: concurrent tick() skipped while first is running", async () => {
    let resolveProvider!: (value: CandleSeries) => void;
    const slowProvider: MarketDataProvider = {
      name: "slow",
      fetchCandles: async () =>
        new Promise<CandleSeries>((res) => {
          resolveProvider = res;
        }),
    };

    const { scanner } = makeScanner(slowProvider);

    // Start first tick (will hang until resolveProvider is called)
    const p1 = scanner.tick();
    expect(scanner.scanning).toBe(true);

    // Call second tick concurrently
    const p2 = scanner.tick();
    const tick2Result = await p2;
    expect(tick2Result.newBars).toHaveLength(0);
    expect(tick2Result.fetched).toBe(0);

    // Resolve first tick
    resolveProvider(series([bar(0)]));
    const tick1Result = await p1;
    expect(tick1Result.fetched).toBe(1);
    expect(scanner.scanning).toBe(false);

    // Subsequent tick works normally
    const p3 = scanner.tick();
    expect(scanner.scanning).toBe(true);
    resolveProvider(series([bar(0)]));
    await p3;
    expect(scanner.scanning).toBe(false);
  });

  it("recovers safely from unexpected tick exceptions without permanently setting scanning = true", async () => {
    const throwingProvider: MarketDataProvider = {
      name: "throwing",
      fetchCandles: async () => {
        throw new Error("fatal provider explosion");
      },
    };

    const { scanner } = makeScanner(throwingProvider);
    const result = await scanner.tick();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("fatal provider explosion");
    expect(scanner.scanning).toBe(false);

    // Second tick executes normally after error
    const secondResult = await scanner.tick();
    expect(secondResult.errors).toHaveLength(1);
    expect(scanner.scanning).toBe(false);
  });
});

describe("Candle-Close Timing & Scheduler Alignment", () => {
  it("calculates remaining ms until next M5 candle boundary plus buffer", () => {
    // 100_000 ms into M5 bar (300_000 ms total) -> 200_000 ms remaining + 500 buffer = 200_500 ms
    // Capped at fallbackIntervalMs = 600_000
    const delay = calculateMsToNextCandleClose(["M5"], 100_000, 600_000, 500);
    expect(delay).toBe(200_500);
  });

  it("aligns closely near candle close boundary", () => {
    // 295_000 ms into M5 bar (5_000 ms remaining) + 500 buffer = 5_500 ms
    const delay = calculateMsToNextCandleClose(["M5"], 295_000, 60_000, 500);
    expect(delay).toBe(5_500);
  });

  it("caps delay at fallbackIntervalMs when next candle close is further away", () => {
    // 100_000 ms into M5 bar -> 200_500 ms target, but fallback is 60_000 ms -> capped at 60_000
    const delay = calculateMsToNextCandleClose(["M5"], 100_000, 60_000, 500);
    expect(delay).toBe(60_000);
  });

  it("returns safe fallback if timeframes array is empty", () => {
    const delay = calculateMsToNextCandleClose([], 100_000, 60_000);
    expect(delay).toBe(60_000);
  });
});

describe("ScannerScheduler — Uncaught Error Handling & Clean Shutdown", () => {
  it("executes initial pass on start and handles clean, idempotent shutdown", async () => {
    let passCount = 0;
    const scheduler = new ScannerScheduler({
      timeframes: ["M5"],
      scanIntervalMs: 10_000,
      log,
      runPass: async () => {
        passCount += 1;
      },
    });

    expect(scheduler.running).toBe(false);
    expect(scheduler.stopped).toBe(false);

    await scheduler.start();
    expect(passCount).toBe(1);
    expect(scheduler.running).toBe(true);

    // Shutdown
    scheduler.stop();
    expect(scheduler.stopped).toBe(true);
    expect(scheduler.running).toBe(false);

    // Calling stop twice is safe and idempotent
    expect(() => scheduler.stop()).not.toThrow();
    expect(scheduler.stopped).toBe(true);
  });

  it("tolerates uncaught pass errors without dying or stopping the scheduler", async () => {
    let passAttempts = 0;
    const scheduler = new ScannerScheduler({
      timeframes: ["M5"],
      scanIntervalMs: 10_000,
      log,
      runPass: async () => {
        passAttempts += 1;
        if (passAttempts === 1) {
          throw new Error("unexpected pipeline crash during pass");
        }
      },
    });

    // Start scheduler (pass 1 will throw uncaught error inside runPass)
    await expect(scheduler.start()).resolves.not.toThrow();
    expect(passAttempts).toBe(1);

    // Second pass manual execution runs cleanly
    await scheduler.executePass();
    expect(passAttempts).toBe(2);

    scheduler.stop();
  });
});

describe("Integration: Candle-Close Trigger + P2-12 Idempotency Protection", () => {
  it("prevents duplicate signal generation when candle close triggers repeatedly", async () => {
    const bus = new EventBus();
    const cache = new CandleCache();
    const repo = new NullRepository();
    const idempotency = new IdempotencyGuard();

    const confluence = new ConfluenceEngine([new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()]);
    const strategy = new StrongCandleStrategy();
    const setupStore = new SetupStore();

    const pipeline = new TradingPipeline({
      bus,
      cache,
      confluence,
      strategy,
      setupStore,
      ai: {
        complete: vi.fn(),
      } as any,
      riskConfig: {
        perTradePct: 0.5,
        minRiskPerTradePct: 0.01,
        maxRiskPerTradePct: 5.0,
        dailyLossCapPct: 3,
        weeklyLossCapPct: 6,
        maxDrawdownPct: 10,
        maxOpenTrades: 2,
        netExposureMax: 1.5,
        marginCeilingPct: 50,
        accountEquity: 10_000,
        minStopDistancePts: 1.0,
        maxStopDistancePts: 50.0,
        maxLot: 10.0,
      },
      riskEnv: () => ({ equity: 10_000, state: DEFAULT_RISK_STATE, killSwitch: "NONE" }),
      repo,
      telegram: new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log),
      mode: "ANALYSIS_ONLY",
      log,
      idempotency,
    });

    const src = FixtureSource.fromSeries([series([0, 1, 2].map(bar))]);
    const scanner = new Scanner(src, cache, { symbols: ["XAUUSD"], timeframes: ["M5"], limit: 10, scanIntervalMs: 1000 }, log);

    // First scan tick yields 3 new bars
    const tick1 = await scanner.tick();
    const events1 = collectClosedBarEvents(tick1);
    expect(events1).toHaveLength(3);

    for (const evt of events1) {
      await pipeline.onBarClosed(evt.symbol, evt.timeframe);
    }

    // Repeat scan tick on identical data near candle close boundary
    const tick2 = await scanner.tick();
    const events2 = collectClosedBarEvents(tick2);
    // Duplicate candles in cache return 0 new bar events
    expect(events2).toHaveLength(0);
  });
});
