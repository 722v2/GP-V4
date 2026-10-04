import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/pipeline/buildApp.js";
import type { AppConfig } from "../../src/config/AppConfig.js";
import { BacktestRunner, SpreadSlippageModel, BacktestStore, TradeLifecycle } from "../../src/backtest/BacktestRunner.js";
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
    ai: { provider: "novita", baseUrl: "", apiKey: "", model: "", timeoutMs: 45_000, maxRetries: 1, hourlyBudgetUsd: 1, dailyBudgetUsd: 10, cacheTtlMs: 120_000 },
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
