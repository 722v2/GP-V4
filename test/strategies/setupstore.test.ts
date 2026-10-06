import { describe, expect, it, vi } from "vitest";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import type { Setup } from "../../src/core/types/Setup.js";
import { TradingPipeline } from "../../src/pipeline/TradingPipeline.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StrongCandleStrategy } from "../../src/strategies/StrongCandleStrategy.js";
import { NullRepository } from "../../src/persistence/Persistence.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { Candle } from "../../src/core/types/Candle.js";

import type { Symbol } from "../../src/core/types/MarketTypes.js";

const TF_M5 = 300_000;
const TF_H1 = 3_600_000;

function makeSetup(
  id: string,
  symbol: Symbol = "XAUUSD",
  timeframe: "M5" | "H1" = "M5",
  barOpenTime = 1_000_000,
  state: Setup["state"] = "ACTIVE"
): Setup {
  return {
    id,
    strategyId: "strong-candle",
    symbol,
    timeframe,
    direction: "LONG",
    barOpenTime,
    createdAt: barOpenTime,
    state,
    entry: 2000,
    stopLoss: 1990,
    takeProfit1: 2010,
    takeProfit2: 2020,
    invalidationPrice: 1990,
    rationale: "test",
    evidence: [],
  };
}

describe("P2-16 Setup Expiry & SetupStore Cleanup", () => {
  it("A: setup with expiryBars=3 remains active before the boundary (2 bars elapsed)", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    store.add(setup);

    // Current bar is 1,600,000 → (1,600,000 - 1,000,000) / 300,000 = 2 bars elapsed
    const result = store.expireAndCleanup("XAUUSD", "M5", 1_600_000, 3);
    expect(result.expired).toHaveLength(0);
    expect(store.get("s1")).toBeDefined();
    expect(store.get("s1")?.state).toBe("ACTIVE");
  });

  it("B: setup expires exactly at the correct completed-bar boundary (3 bars elapsed)", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    store.add(setup);

    // Current bar is 1,900,000 → (1,900,000 - 1,000,000) / 300,000 = 3 bars elapsed
    const result = store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0]!.id).toBe("s1");
    expect(result.expired[0]!.state).toBe("EXPIRED");
    // After cleanup, expired setup is removed from active memory
    expect(store.get("s1")).toBeUndefined();
  });

  it("C: incomplete/current candle does not count towards elapsed bars", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    store.add(setup);

    // Passing 1,899,999 ms (just before 3rd completed bar open time) → Math.floor(899999 / 300000) = 2 bars
    const result = store.expireAndCleanup("XAUUSD", "M5", 1_899_999, 3);
    expect(result.expired).toHaveLength(0);
    expect(store.get("s1")?.state).toBe("ACTIVE");
  });

  it("D: expiryBars=0 or invalid configuration follows safe defined behavior", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    store.add(setup);

    // expiryBars = 0 expires immediately on the same bar
    const result0 = store.expireAndCleanup("XAUUSD", "M5", 1_000_000, 0);
    expect(result0.expired).toHaveLength(1);

    // Invalid negative expiryBars falls back to default 6 bars safely
    const store2 = new SetupStore();
    const setup2 = makeSetup("s2", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    store2.add(setup2);
    const resultInvalid = store2.expireAndCleanup("XAUUSD", "M5", 1_600_000, -5);
    expect(resultInvalid.expired).toHaveLength(0); // 2 bars elapsed < default 6
  });

  it("E: repeated cleanup is idempotent", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    store.add(setup);

    const first = store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(first.expired).toHaveLength(1);

    const second = store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(second.expired).toHaveLength(0);
    expect(second.cleanedCount).toBe(0);
  });

  it("F: expired setup is removed from active SetupStore collection", () => {
    const store = new SetupStore();
    store.add(makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE"));
    expect(store.count).toBe(1);

    store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(store.count).toBe(0);
    expect(store.all()).toHaveLength(0);
  });

  it("G & H: EXPIRED state is persisted through existing persistence path and handles failure safely", async () => {
    const bus = new EventBus();
    const repo = new NullRepository();
    const saveSetupSpy = vi.spyOn(repo, "saveSetup");

    const setupStore = new SetupStore();
    setupStore.add(makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE"));

    const log = createConsoleLogger("test");
    const pipeline = new TradingPipeline({
      bus,
      cache: new CandleCache(),
      confluence: new ConfluenceEngine([]),
      strategy: new StrongCandleStrategy(),
      setupStore,
      ai: { analyze: vi.fn() } as any,
      riskConfig: { perTradePct: 0.5, dailyLossCapPct: 3, weeklyLossCapPct: 6, maxDrawdownPct: 10, maxOpenTrades: 2, netExposureMax: 1.5, marginCeilingPct: 50, accountEquity: 10000 },
      riskEnv: () => ({ equity: 10000, state: {} as any, killSwitch: "NONE" }),
      repo,
      telegram: new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log),
      mode: "ANALYSIS_ONLY",
      log,
      expiryBars: 3,
    });

    const candles: Candle[] = [
      { symbol: "XAUUSD", timeframe: "M5", openTime: 1_900_000, open: 2000, high: 2005, low: 1995, close: 2002, volume: 100, closeTime: 1_900_000 + TF_M5 - 1 },
    ];
    pipeline["deps"].cache.append({ symbol: "XAUUSD", timeframe: "M5", candles });

    await pipeline.onBarClosed("XAUUSD", "M5");
    expect(saveSetupSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", state: "EXPIRED" }));
  });

  it("I: INVALIDATED setup is not incorrectly changed to EXPIRED", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "INVALIDATED");
    store.add(setup);

    const result = store.expireAndCleanup("XAUUSD", "M5", 2_000_000, 3);
    expect(result.expired).toHaveLength(0); // Not added to expired list
    expect(store.get("s1")).toBeUndefined(); // Cleaned as terminal
  });

  it("J: TRIGGERED setup is not incorrectly expired", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "TRIGGERED");
    store.add(setup);

    const result = store.expireAndCleanup("XAUUSD", "M5", 2_000_000, 3);
    expect(result.expired).toHaveLength(0);
  });

  it("K: multi-timeframe setup expiry uses its own timeframe", () => {
    const store = new SetupStore();
    // M5 setup created at 1,000,000
    const m5Setup = makeSetup("m5_1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    // H1 setup created at 1,000,000
    const h1Setup = makeSetup("h1_1", "XAUUSD", "H1", 1_000_000, "ACTIVE");
    store.add(m5Setup);
    store.add(h1Setup);

    // Current bar for M5 is 1,900,000 (3 M5 bars elapsed)
    const m5Result = store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(m5Result.expired).toHaveLength(1);
    expect(m5Result.expired[0]!.id).toBe("m5_1");

    // H1 setup remains active in memory because only 15 minutes elapsed (< 3 H1 bars)
    expect(store.get("h1_1")).toBeDefined();
    expect(store.get("h1_1")?.state).toBe("ACTIVE");
  });

  it("L: no lookahead in expiry", () => {
    const store = new SetupStore();
    const setup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    store.add(setup);

    // At bar N+1, setup is NOT expired
    const r1 = store.expireAndCleanup("XAUUSD", "M5", 1_300_000, 3);
    expect(r1.expired).toHaveLength(0);

    // At bar N+2, setup is NOT expired
    const r2 = store.expireAndCleanup("XAUUSD", "M5", 1_600_000, 3);
    expect(r2.expired).toHaveLength(0);

    // At bar N+3, setup expires
    const r3 = store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(r3.expired).toHaveLength(1);
  });

  it("M: restored expired setup does not remain active after startup/reconciliation", () => {
    const store = new SetupStore();
    // Restore only accepts NEW, ACTIVE, UPDATED
    const restoredSetups = [
      makeSetup("active1", "XAUUSD", "M5", 1_000_000, "ACTIVE"),
      makeSetup("expired1", "XAUUSD", "M5", 500_000, "EXPIRED"),
    ];
    store.restore(restoredSetups);

    expect(store.get("expired1")).toBeUndefined();
    expect(store.get("active1")).toBeDefined();

    // On first scan pass at 1_900_000, stale restored active setup is expired immediately
    store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(store.get("active1")).toBeUndefined();
  });

  it("N: historical terminal setup remains available through persistence", async () => {
    const repo = new NullRepository();
    const expiredSetup = makeSetup("s1", "XAUUSD", "M5", 1_000_000, "EXPIRED");
    await repo.saveSetup(expiredSetup);
    // NullRepository saveSetup does not fail or crash
  });

  it("O: expiry does not trigger AI or execution", async () => {
    const bus = new EventBus();
    const repo = new NullRepository();
    const aiSpy = vi.fn();

    const setupStore = new SetupStore();
    setupStore.add(makeSetup("s1", "XAUUSD", "M5", 1_000_000, "ACTIVE"));

    const log = createConsoleLogger("test");
    const pipeline = new TradingPipeline({
      bus,
      cache: new CandleCache(),
      confluence: new ConfluenceEngine([]),
      strategy: new StrongCandleStrategy(),
      setupStore,
      ai: { analyze: aiSpy } as any,
      riskConfig: { perTradePct: 0.5, dailyLossCapPct: 3, weeklyLossCapPct: 6, maxDrawdownPct: 10, maxOpenTrades: 2, netExposureMax: 1.5, marginCeilingPct: 50, accountEquity: 10000 },
      riskEnv: () => ({ equity: 10000, state: {} as any, killSwitch: "NONE" }),
      repo,
      telegram: new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log),
      mode: "ANALYSIS_ONLY",
      log,
      expiryBars: 3,
    });

    const candles: Candle[] = [
      { symbol: "XAUUSD", timeframe: "M5", openTime: 1_900_000, open: 2000, high: 2005, low: 1995, close: 2002, volume: 100, closeTime: 1_900_000 + TF_M5 - 1 },
    ];
    pipeline["deps"].cache.append({ symbol: "XAUUSD", timeframe: "M5", candles });

    await pipeline.onBarClosed("XAUUSD", "M5");

    // AI is NOT called for setup expiry
    expect(aiSpy).not.toHaveBeenCalled();
  });

  it("P & Q: multiple setups expire independently and cleanup does not affect still-active setups", () => {
    const store = new SetupStore();
    const oldSetup1 = makeSetup("old1", "XAUUSD", "M5", 1_000_000, "ACTIVE");
    const oldSetup2 = makeSetup("old2", "XAUUSD", "M5", 1_300_000, "ACTIVE");
    const freshSetup = makeSetup("fresh1", "XAUUSD", "M5", 1_900_000, "ACTIVE");

    store.add(oldSetup1);
    store.add(oldSetup2);
    store.add(freshSetup);

    // Current bar is 1_900_000, expiryBars = 3
    // old1: (1900000 - 1000000) / 300000 = 3 bars -> EXPIRED
    // old2: (1900000 - 1300000) / 300000 = 2 bars -> ACTIVE
    // fresh1: (1900000 - 1900000) / 300000 = 0 bars -> ACTIVE

    const result = store.expireAndCleanup("XAUUSD", "M5", 1_900_000, 3);
    expect(result.expired).toHaveLength(1);
    expect(result.expired[0]!.id).toBe("old1");

    expect(store.get("old1")).toBeUndefined(); // expired and cleaned
    expect(store.get("old2")?.state).toBe("ACTIVE");
    expect(store.get("fresh1")?.state).toBe("ACTIVE");
    expect(store.count).toBe(2);
  });
});
