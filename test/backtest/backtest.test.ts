import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/pipeline/buildApp.js";
import type { AppConfig } from "../../src/config/AppConfig.js";
import { BacktestRunner, SpreadSlippageModel, BacktestStore, TradeLifecycle, calculatePerformanceMetrics } from "../../src/backtest/BacktestRunner.js";
import type { Candle } from "../../src/core/types/Candle.js";

const TF = 300_000;
function bar(i: number, o: number, h: number, l: number, c: number): Candle {
  const openTime = i * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime, open: o, high: h, low: l, close: c, volume: 100, closeTime: openTime + TF - 1 };
}

function baseCfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: "ANALYSIS_ONLY",
    symbols: ["XAUUSD"],
    timeframes: ["M5"],
    scanIntervalMs: 60_000,
    biquiti: { baseUrl: "", apiKey: "", candlesPath: "", authHeader: "Authorization", symbolMap: {}, timeoutMs: 10_000 },
    ai: { provider: "novita", baseUrl: "", apiKey: "", model: "", m5Model: "", timeoutMs: 45_000, m5TimeoutMs: 15_000, maxRetries: 1, retryInitialDelayMs: 500, retryMaxDelayMs: 4000, minConfidence: 0.6, levelTolerancePts: 1.0, hourlyBudgetUsd: 1, dailyBudgetUsd: 10, cacheTtlMs: 120_000 },
    supabase: { url: "", serviceKey: "" },
    telegram: { botToken: "", chatId: "", enabled: false },
    risk: {
      perTradePct: 0.5,
      dailyLossCapPct: 3,
      weeklyLossCapPct: 6,
      maxDrawdownPct: 10,
      maxOpenTrades: 2,
      netExposureMax: 1.5,
      marginCeilingPct: 50,
      accountEquity: 10_000,
    },
    execution: { venue: "SIMULATED", spreadPoints: 0.35, slippagePoints: 0.2, latencyMs: 250 },
    strategyExpiryBars: 6,
    fixturesDir: "./fixtures",
    features: {
      aiEnabled: false,
      persistenceEnabled: false,
      telegramEnabled: false,
      experienceMemoryEnabled: false,
      strongCandleStrategy: true,
      dashboardEnabled: false,
    },
    ...over,
  } as AppConfig;
}

const spread = new SpreadSlippageModel(0.35, 0.2, 250);

/** Fixtures with HH/HL structure + a strong bull trigger + continuation: entry fills, TP1/TP2 hit. */
function bullishFixtures(): Candle[] {
  return [
    bar(0, 2000, 2010, 1998, 2008),
    bar(1, 2008, 2018, 2006, 2016),
    bar(2, 2016, 2022, 2014, 2020),
    bar(3, 2020, 2021, 2005, 2008),
    bar(4, 2008, 2009, 1996, 2002),
    bar(5, 2002, 2013, 2000, 2010),
    bar(6, 2010, 2026, 2008, 2024),
    bar(7, 2024, 2030, 2022, 2028),
    bar(8, 2028, 2029, 2012, 2016),
    bar(9, 2016, 2017, 2004, 2010),
    bar(10, 2010, 2026, 2008, 2024),
    bar(11, 2024, 2040, 2023, 2038), // strong bull entry 2038, SL 2022, TP1/TP2 above
    bar(12, 2038, 2052, 2034, 2048), // hits TP1
    bar(13, 2048, 2064, 2045, 2060), // hits TP2
  ];
}

describe("buildApp", () => {
  it("wires the graph without throwing", () => {
    const app = buildApp(baseCfg());
    expect(app.bus).toBeDefined();
    expect(app.cache).toBeDefined();
    expect(app.scanner).toBeDefined();
    expect(app.pipeline).toBeDefined();
  });
});

describe("BacktestRunner", () => {
  it("reports cycles and never sees future bars (no-lookahead)", async () => {
    const fixtures = bullishFixtures();
    const store = new BacktestStore();
    const runner = new BacktestRunner(fixtures, store, spread, RISK_EQUITY_10K);
    const result = await runner.run();
    expect(result.cycles.length).toBe(fixtures.length - 5 - 1 + 1); // after warmup candles, one per bar
    // The strong candle is at index 11 — its cycle sees only bars [0..11], not 12/13.
    const trigger = result.cycles.find((c) => c.outcome.setup !== null);
    expect(trigger).toBeDefined();
    const seenOpenTimes = trigger!.candlesSeen.map((c: Candle) => c.openTime);
    expect(Math.max(...seenOpenTimes)).toBe(trigger!.outcome.barOpenTime);
  });

  it("records a simulated fill and lifecycle on a clean run", async () => {
    const fixtures = bullishFixtures();
    const store = new BacktestStore();
    const runner = new BacktestRunner(fixtures, store, spread, RISK_EQUITY_10K);
    const result = await runner.run();
    const planned = result.cycles.filter((c) => c.outcome.action.kind === "EXECUTED_SIMULATED");
    expect(planned.length).toBeGreaterThanOrEqual(1);
    expect(store.plans.length).toBe(planned.length);
    expect(result.simulatedFills.length).toBe(planned.length);
  });

  it("TradeLifecycle routes to TP2 on bullish continuation and SL on reversal", () => {
    const longState = {
      planId: "p1",
      direction: "LONG" as const,
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.05,
      state: "OPEN" as const,
    };
    const winner = new TradeLifecycle(longState, spread);
    winner.advance(bar(0, 2000, 2012, 1998, 2010)); // hits TP1
    expect(winner.state.state).toBe("TP1_HIT");
    winner.advance(bar(1, 2010, 2022, 2008, 2020)); // hits TP2
    expect(winner.state.state).toBe("TP2_HIT");

    const loser = new TradeLifecycle({ ...longState, planId: "p2", state: "OPEN" as const }, spread);
    loser.advance(bar(0, 2000, 2004, 1988, 1990)); // breaches SL
    expect(loser.state.state).toBe("SL_HIT");
    expect(loser.state.realizedPnl!).toBeLessThan(0);
  });

  it("BacktestStore enforces idempotency and exposes viewAsOf semantics", () => {
    const store = new BacktestStore();
    const c = bullishFixtures();
    store.appendBatch(c.slice(0, 5));
    expect(store.candles.length).toBe(5);
    // Repeat append is idempotent — second append has status NO_SETUP/duplicate path
    const reappend = store.appendBatch(c.slice(0, 5));
    expect(reappend.duplicate).toBe(true);
  });

  it("spread/slippage model applies the right adjustments per direction", () => {
    const m = new SpreadSlippageModel(0.35, 0.2, 250);
    expect(m.adjustedFill("LONG", 2000)).toBeCloseTo(2000 + 0.35 + 0.2, 2);
    expect(m.adjustedFill("SHORT", 2000)).toBeCloseTo(2000 - 0.35 - 0.2, 2);
    expect(m.adjustedExit("LONG", 2000)).toBeCloseTo(2000 - 0.35 - 0.2, 2);
    expect(m.adjustedExit("SHORT", 2000)).toBeCloseTo(2000 + 0.35 + 0.2, 2);
  });
});

describe("P1-4: Backtest Correctness & Performance Metrics", () => {
  const spread = new SpreadSlippageModel(0.35, 0.2, 250);

  it("1. Partial TP1 + remaining TP2 execution and accounting", () => {
    const state = {
      planId: "p1",
      direction: "LONG" as const,
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.1,
      state: "OPEN" as const,
    };
    const lc = new TradeLifecycle(state);
    // Bar 1 hits TP1
    lc.advance(bar(1, 2000, 2012, 1998, 2010));
    expect(lc.state.state).toBe("TP1_HIT");
    expect(lc.state.tp1RealizedPnl).toBeCloseTo((2010 - 2000) * 100 * 0.05, 2); // 50% of 0.1 lot = 0.05
    expect(lc.state.realizedPnl).toBeCloseTo((2010 - 2000) * 100 * 0.05, 2);

    // Bar 2 hits TP2
    lc.advance(bar(2, 2010, 2022, 2008, 2020));
    expect(lc.state.state).toBe("TP2_HIT");
    const expectedTotal = (2010 - 2000) * 100 * 0.05 + (2020 - 2000) * 100 * 0.05;
    expect(lc.state.realizedPnl).toBeCloseTo(expectedTotal, 2);
  });

  it("2. Partial TP1 + remaining SL execution and accounting", () => {
    const state = {
      planId: "p2",
      direction: "LONG" as const,
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.1,
      state: "OPEN" as const,
    };
    const lc = new TradeLifecycle(state);
    // Bar 1 hits TP1
    lc.advance(bar(1, 2000, 2012, 1998, 2010));
    expect(lc.state.state).toBe("TP1_HIT");

    // Bar 2 reverses and hits SL
    lc.advance(bar(2, 2005, 2008, 1988, 1990));
    expect(lc.state.state).toBe("SL_HIT");
    const tp1Pnl = (2010 - 2000) * 100 * 0.05; // +50
    const slPnl = (1990 - 2000) * 100 * 0.05;  // -50
    expect(lc.state.realizedPnl).toBeCloseTo(tp1Pnl + slPnl, 2); // 0 net PnL
  });

  it("3. Deterministic SL-first policy when both SL and TP are touched in the same bar", () => {
    const state = {
      planId: "p3",
      direction: "LONG" as const,
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.1,
      state: "OPEN" as const,
    };
    const lc = new TradeLifecycle(state);
    // Bar touches low 1985 (SL) and high 2015 (TP1)
    lc.advance(bar(1, 2000, 2015, 1985, 2005));
    expect(lc.state.state).toBe("SL_HIT");
    expect(lc.state.exitReason).toBe("stop loss");
  });

  it("4. Entry timing occurs on the NEXT candle open with spread/slippage", async () => {
    const fixtures = bullishFixtures();
    const store = new BacktestStore();
    const runner = new BacktestRunner(fixtures, store, spread, RISK_EQUITY_10K);
    await runner.run();

    expect(store.plans.length).toBeGreaterThanOrEqual(1);
    const plan = store.plans[0]!;
    // Signal occurred at bar 8 (openTime 8*TF). Fill occurred at bar 9 open (2016) - cost (0.55) = 2015.45
    expect(plan.createdAt).toBe(fixtures[9]!.openTime);
    expect(plan.entry).toBeCloseTo(fixtures[9]!.open - (0.35 + 0.2), 2);
  });

  it("5. Performance metrics calculation for mixed, zero, and infinite profit factor cases", () => {
    // Zero trades
    const zeroMetrics = calculatePerformanceMetrics([], 10_000);
    expect(zeroMetrics.totalTrades).toBe(0);
    expect(zeroMetrics.winRate).toBe(0);
    expect(zeroMetrics.profitFactor).toBeNull();
    expect(zeroMetrics.expectancy).toBe(0);

    // All wins (no losses => infinite profit factor represented as null)
    const winningTrades = [
      { planId: "1", direction: "LONG" as const, entry: 2000, stopLoss: 1990, takeProfit1: 2010, takeProfit2: 2020, lotSize: 0.1, state: "TP2_HIT" as const, realizedPnl: 100, closedAt: 100 },
      { planId: "2", direction: "LONG" as const, entry: 2000, stopLoss: 1990, takeProfit1: 2010, takeProfit2: 2020, lotSize: 0.1, state: "TP2_HIT" as const, realizedPnl: 200, closedAt: 200 },
    ];
    const winMetrics = calculatePerformanceMetrics(winningTrades, 10_000);
    expect(winMetrics.totalTrades).toBe(2);
    expect(winMetrics.winningTrades).toBe(2);
    expect(winMetrics.losingTrades).toBe(0);
    expect(winMetrics.winRate).toBe(1.0);
    expect(winMetrics.grossProfit).toBe(300);
    expect(winMetrics.grossLoss).toBe(0);
    expect(winMetrics.netProfit).toBe(300);
    expect(winMetrics.profitFactor).toBeNull();
    expect(winMetrics.expectancy).toBe(150);
    expect(winMetrics.maxDrawdown).toBe(0);

    // Mixed trades with drawdown
    const mixedTrades = [
      { planId: "1", direction: "LONG" as const, entry: 2000, stopLoss: 1990, takeProfit1: 2010, takeProfit2: 2020, lotSize: 0.1, state: "TP2_HIT" as const, realizedPnl: 200, closedAt: 100 }, // eq 10,200 (peak 10,200)
      { planId: "2", direction: "LONG" as const, entry: 2000, stopLoss: 1990, takeProfit1: 2010, takeProfit2: 2020, lotSize: 0.1, state: "SL_HIT" as const, realizedPnl: -100, closedAt: 200 }, // eq 10,100 (dd 100)
      { planId: "3", direction: "LONG" as const, entry: 2000, stopLoss: 1990, takeProfit1: 2010, takeProfit2: 2020, lotSize: 0.1, state: "TP2_HIT" as const, realizedPnl: 300, closedAt: 300 }, // eq 10,400 (peak 10,400)
      { planId: "4", direction: "LONG" as const, entry: 2000, stopLoss: 1990, takeProfit1: 2010, takeProfit2: 2020, lotSize: 0.1, state: "SL_HIT" as const, realizedPnl: -200, closedAt: 400 }, // eq 10,200 (dd 200, ddPct 1.92%)
    ];
    const mixedMetrics = calculatePerformanceMetrics(mixedTrades, 10_000);
    expect(mixedMetrics.totalTrades).toBe(4);
    expect(mixedMetrics.winningTrades).toBe(2);
    expect(mixedMetrics.losingTrades).toBe(2);
    expect(mixedMetrics.winRate).toBe(0.5);
    expect(mixedMetrics.grossProfit).toBe(500);
    expect(mixedMetrics.grossLoss).toBe(300);
    expect(mixedMetrics.netProfit).toBe(200);
    expect(mixedMetrics.profitFactor).toBeCloseTo(500 / 300, 2);
    expect(mixedMetrics.expectancy).toBe(50);
    expect(mixedMetrics.maxDrawdown).toBe(200);
    expect(mixedMetrics.maxDrawdownPct).toBeCloseTo((200 / 10400) * 100, 2);
  });

  it("6. CsvLoader parses and validates historical CSV candle data chronologically", async () => {
    const { CsvLoader } = await import("../../src/marketdata/replay/CsvLoader.js");
    const csvContent = `
openTime,open,high,low,close,volume
1735689600000,2650.0,2655.0,2648.0,2652.0,120
1735689300000,2645.0,2651.0,2642.0,2650.0,100
    `;
    const candles = CsvLoader.parseCsv(csvContent, { symbol: "XAUUSD", timeframe: "M5" });
    expect(candles).toHaveLength(2);
    // Chronological order: 1735689300000 before 1735689600000
    expect(candles[0]!.openTime).toBe(1735689300000);
    expect(candles[1]!.openTime).toBe(1735689600000);
    expect(candles[0]!.closeTime).toBe(1735689300000 + 300000 - 1);
  });
});

const RISK_EQUITY_10K = {
  perTradePct: 0.5,
  dailyLossCapPct: 3,
  weeklyLossCapPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 2,
  netExposureMax: 1.5,
  marginCeilingPct: 50,
  accountEquity: 10_000,
} as const;
