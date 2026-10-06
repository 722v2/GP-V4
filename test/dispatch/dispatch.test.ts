import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { dispatchRuntime } from "../../src/index.js";
import { FixtureLoader } from "../../src/marketdata/replay/FixtureLoader.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { NullRepository } from "../../src/persistence/Persistence.js";
import { TelegramNotifier } from "../../src/telegram/TelegramNotifier.js";
import { StrongCandleStrategy } from "../../src/strategies/StrongCandleStrategy.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { AiRouter, DEFAULT_AI_ROUTER_CONFIG } from "../../src/ai/AiRouter.js";
import { BudgetGuard } from "../../src/ai/BudgetGuard.js";
import { CircuitBreaker } from "../../src/ai/CircuitBreaker.js";
import { ContextBuilder } from "../../src/ai/ContextBuilder.js";
import { TradingPipeline } from "../../src/pipeline/TradingPipeline.js";
import { RiskStateTracker } from "../../src/risk/RiskStateTracker.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { SpreadSlippageModel } from "../../src/execution/TradeLifecycle.js";
import { SimulatedProtection } from "../../src/execution/BrokerProtection.js";
import { SimulatedPositionManager } from "../../src/execution/SimulatedPositionManager.js";
import { ReconciliationService } from "../../src/safety/Reconciliation.js";
import { IdempotencyGuard } from "../../src/safety/IdempotencyGuard.js";
import type { AppConfig } from "../../src/config/AppConfig.js";
import type { Candle } from "../../src/core/types/Candle.js";
import type { Scanner } from "../../src/scanner/Scanner.js";

const log = createConsoleLogger("test");

function makeTestCandles(count = 12): Candle[] {
  const tf = 300_000;
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const openTime = 1704067200000 + i * tf;
    candles.push({
      symbol: "XAUUSD",
      timeframe: "M5",
      openTime,
      closeTime: openTime + tf - 1,
      open: 2060 + i * 2,
      high: 2064 + i * 2,
      low: 2059 + i * 2,
      close: 2063 + i * 2,
      volume: 100,
    });
  }
  return candles;
}

function makeMockApp(opts: { onScannerTick?: () => void } = {}) {
  const bus = new EventBus();
  const cache = new CandleCache();
  const repo = new NullRepository();
  const telegram = new TelegramNotifier({ botToken: "", chatId: "", enabled: false }, log);
  const confluence = new ConfluenceEngine([new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()]);
  const strategy = new StrongCandleStrategy();
  const setupStore = new SetupStore();
  const ai = new AiRouter(
    {
      name: "mock-ai",
      complete: async () => ({
        content: JSON.stringify({
          decision: "NO_TRADE",
          direction: "LONG",
          confidence: 0.5,
          evidence: [],
          risk_notes: [],
          reassessment_conditions: [],
          reason_codes: [],
        }),
        usage: { prompt: 10, completion: 5 },
        model: "mock",
      }),
    },
    new BudgetGuard({ hourlyBudgetUsd: 1, dailyBudgetUsd: 10 }),
    new CircuitBreaker(5, 60_000, () => 0),
    new ContextBuilder(),
    log,
    { ...DEFAULT_AI_ROUTER_CONFIG, cacheTtlMs: 60_000 },
    () => 1_000_000
  );

  const riskConfig = {
    perTradePct: 0.5,
    dailyLossCapPct: 3,
    weeklyLossCapPct: 6,
    maxDrawdownPct: 10,
    maxOpenTrades: 2,
    netExposureMax: 1.5,
    marginCeilingPct: 50,
    accountEquity: 10_000,
  };
  const riskTracker = new RiskStateTracker(10_000);
  const killSwitch = new KillSwitch();
  const spreadModel = new SpreadSlippageModel(0.35, 0.20, 250);
  const protection = new SimulatedProtection();
  const idempotency = new IdempotencyGuard();

  const pipeline = new TradingPipeline({
    bus,
    cache,
    confluence,
    strategy,
    setupStore,
    ai,
    riskConfig,
    riskEnv: () => ({
      equity: 10_000,
      state: riskTracker.state,
      killSwitch: "NONE",
    }),
    repo,
    telegram,
    mode: "ANALYSIS_ONLY",
    log,
    idempotency,
    spreadModel,
  });

  const scanner = {
    tick: vi.fn().mockImplementation(async () => {
      if (opts.onScannerTick) opts.onScannerTick();
      return { newBars: [], errors: [] };
    }),
  } as unknown as Scanner;

  const positionManager = new SimulatedPositionManager({ bus, repo, spreadModel, protection });
  const reconciliation = new ReconciliationService(protection);
  const adapter = { isConfigured: () => false, health: vi.fn() } as any;
  const marketFilterEngine = { evaluate: vi.fn().mockResolvedValue({ passed: true, rejections: [], details: {} }) } as any;
  const broker = { isSimulated: true, getHealth: vi.fn().mockResolvedValue({ connected: true }) } as any;
  const executionEngine = {} as any;
  const promotionEngine = {} as any;

  return {
    bus,
    cache,
    scanner,
    pipeline,
    killSwitch,
    riskTracker,
    positionManager,
    protection,
    spreadModel,
    repo,
    setupStore,
    reconciliation,
    idempotency,
    adapter,
    ai,
    telegram,
    marketFilterEngine,
    broker,
    executionEngine,
    promotionEngine,
  };
}

function makeBaseConfig(mode: AppConfig["mode"] = "ANALYSIS_ONLY"): AppConfig {
  return {
    mode,
    symbols: ["XAUUSD"],
    timeframes: ["M5"],
    scanIntervalMs: 60_000,
    biquiti: {
      baseUrl: "",
      apiKey: "",
      candlesPath: "",
      authHeader: "Authorization",
      symbolMap: { XAUUSD: "GOLD" },
      timeoutMs: 10_000,
    },
    ai: {
      provider: "nvidia-nim",
      baseUrl: "",
      apiKey: "test",
      model: "test",
      m5Model: "",
      timeoutMs: 10_000,
      m5TimeoutMs: 10_000,
      maxRetries: 1,
      retryInitialDelayMs: 500,
      retryMaxDelayMs: 4000,
      minConfidence: 0.6,
      levelTolerancePts: 1.0,
      hourlyBudgetUsd: 1,
      dailyBudgetUsd: 10,
      cacheTtlMs: 60_000,
    },
    supabase: { url: "", serviceKey: "" },
    telegram: { botToken: "", chatId: "", enabled: false },
    risk: {
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
    execution: {
      venue: "SIMULATED",
      spreadPoints: 0.35,
      slippagePoints: 0.20,
      latencyMs: 250,
    },
    strategyExpiryBars: 6,
    persistenceMaxRetries: 3,
    persistenceInitialRetryDelayMs: 500,
    persistenceMaxRetryDelayMs: 4000,
    persistenceAlertCooldownMs: 60_000,
    marketFilters: {
      sessionFilterEnabled: false,
      allowedSessions: ["LONDON", "NEW_YORK"],
      spreadFilterEnabled: false,
      maxSpreadPoints: 1.0,
      newsFilterEnabled: false,
      newsWindowMinutes: 30,
    },
    fixturesDir: "./fixtures",
    features: {
      aiEnabled: true,
      persistenceEnabled: false,
      telegramEnabled: false,
      experienceMemoryEnabled: false,
      strongCandleStrategy: true,
      dashboardEnabled: false,
    },
    mt5: {
      enabled: false,
      bridgeUrl: "",
      brokerSymbolXauusd: "XAUUSD",
      accountId: "",
      server: "",
    },
  };
}

describe("A4: Replay/Backtest Mode Dispatch", () => {
  it("ANALYSIS_ONLY dispatches to live scanner and calls scanner.tick()", async () => {
    let tickCalled = false;
    const app = makeMockApp({ onScannerTick: () => { tickCalled = true; } });
    const cfg = makeBaseConfig("ANALYSIS_ONLY");

    const runtime = await dispatchRuntime(cfg, log, { app });
    expect(runtime.mode).toBe("LIVE");
    expect(tickCalled).toBe(true);
    expect(app.scanner.tick).toHaveBeenCalled();
    if (runtime.mode === "LIVE") runtime.stop();
  });

  it("PAPER_TRADING dispatches to live scanner and calls scanner.tick()", async () => {
    let tickCalled = false;
    const app = makeMockApp({ onScannerTick: () => { tickCalled = true; } });
    const cfg = makeBaseConfig("PAPER_TRADING");

    const runtime = await dispatchRuntime(cfg, log, { app });
    expect(runtime.mode).toBe("LIVE");
    expect(tickCalled).toBe(true);
    expect(app.scanner.tick).toHaveBeenCalled();
    if (runtime.mode === "LIVE") runtime.stop();
  });

  it("MANUAL_CONFIRMATION dispatches to live scanner", async () => {
    const app = makeMockApp();
    const cfg = makeBaseConfig("MANUAL_CONFIRMATION");

    const runtime = await dispatchRuntime(cfg, log, { app });
    expect(runtime.mode).toBe("LIVE");
    expect(app.scanner.tick).toHaveBeenCalled();
    if (runtime.mode === "LIVE") runtime.stop();
  });

  it("AUTO_TRADING dispatches to live scanner", async () => {
    const app = makeMockApp();
    const cfg = makeBaseConfig("AUTO_TRADING");

    const runtime = await dispatchRuntime(cfg, log, { app });
    expect(runtime.mode).toBe("LIVE");
    expect(app.scanner.tick).toHaveBeenCalled();
    if (runtime.mode === "LIVE") runtime.stop();
  });

  it("REPLAY invokes ReplayRunner and NEVER invokes scanner.tick()", async () => {
    const app = makeMockApp();
    const cfg = makeBaseConfig("REPLAY");
    const fixtures = makeTestCandles(12);

    const runtime = await dispatchRuntime(cfg, log, { app, fixtures });
    expect(runtime.mode).toBe("REPLAY");
    if (runtime.mode === "REPLAY") {
      expect(runtime.result.candlesProcessed).toBe(7); // 12 - 5 warmup
      expect(runtime.result.cycles).toHaveLength(7);
    }
    // Scanner must never be touched in REPLAY
    expect(app.scanner.tick).not.toHaveBeenCalled();
  });

  it("BACKTEST invokes BacktestRunner and NEVER invokes scanner.tick()", async () => {
    const app = makeMockApp();
    const cfg = makeBaseConfig("BACKTEST");
    const fixtures = makeTestCandles(12);

    const runtime = await dispatchRuntime(cfg, log, { app, fixtures });
    expect(runtime.mode).toBe("BACKTEST");
    if (runtime.mode === "BACKTEST") {
      expect(runtime.result.cycles.length).toBeGreaterThan(0);
      expect(runtime.result.store.candles).toHaveLength(12);
    }
    // Scanner must never be touched in BACKTEST
    expect(app.scanner.tick).not.toHaveBeenCalled();
  });

  it("FixtureLoader loads fixtures from directory and constructs FixtureSource", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fixtures-test-"));
    try {
      const candles = makeTestCandles(10);
      fs.writeFileSync(path.join(tmpDir, "XAUUSD_M5.json"), JSON.stringify(candles, null, 2));

      const { candles: loaded, source } = await FixtureLoader.loadFromDir(tmpDir);
      expect(loaded).toHaveLength(10);
      expect(loaded[0]?.symbol).toBe("XAUUSD");
      expect(source.all("XAUUSD", "M5")).toHaveLength(10);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("FixtureLoader throws on non-existent directory", async () => {
    const nonExistentPath = `./non-existent-path-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    await expect(FixtureLoader.loadFromDir(nonExistentPath)).rejects.toThrow(
      /does not exist/i
    );
  });

  it("FixtureLoader throws on invalid JSON fixture file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fixtures-bad-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "bad.json"), "{ invalid json ");
      await expect(FixtureLoader.loadFromDir(tmpDir)).rejects.toThrow(/Invalid JSON/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("REPLAY is deterministic across identical fixture runs", async () => {
    const app1 = makeMockApp();
    const app2 = makeMockApp();
    const cfg = makeBaseConfig("REPLAY");
    const fixtures = makeTestCandles(10);

    const r1 = await dispatchRuntime(cfg, log, { app: app1, fixtures });
    const r2 = await dispatchRuntime(cfg, log, { app: app2, fixtures });

    if (r1.mode === "REPLAY" && r2.mode === "REPLAY") {
      expect(r1.result.candlesProcessed).toBe(r2.result.candlesProcessed);
      const acts1 = r1.result.cycles.map((c) => c.action.kind);
      const acts2 = r2.result.cycles.map((c) => c.action.kind);
      expect(acts1).toEqual(acts2);
    }
  });
});
