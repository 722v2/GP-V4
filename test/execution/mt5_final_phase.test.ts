import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Mt5Service } from "../../src/execution/broker/Mt5Service.js";
import { JustMarketsMt5Adapter, type Mt5BridgeClient } from "../../src/execution/broker/JustMarketsMt5Adapter.js";
import { ExecutionEngine } from "../../src/execution/ExecutionEngine.js";
import { TradingPipeline } from "../../src/pipeline/TradingPipeline.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { CandleCache } from "../../src/marketdata/CandleCache.js";
import { ConfluenceEngine } from "../../src/strategies/ConfluenceEngine.js";
import { StructureEngine } from "../../src/strategies/engines/StructureEngine.js";
import { LiquidityEngine } from "../../src/strategies/engines/LiquidityEngine.js";
import { PriceActionEngine } from "../../src/strategies/engines/PriceActionEngine.js";
import { StrongCandleStrategy } from "../../src/strategies/StrongCandleStrategy.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { InMemoryRepository } from "../../src/persistence/Persistence.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { RiskStateTracker } from "../../src/risk/RiskStateTracker.js";
import { SpreadSlippageModel } from "../../src/execution/TradeLifecycle.js";
import { MarketFilterEngine } from "../../src/filters/MarketFilterEngine.js";
import { ReconciliationService } from "../../src/safety/Reconciliation.js";
import { SimulatedProtection } from "../../src/execution/BrokerProtection.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { Candle } from "../../src/core/types/Candle.js";
import type { TradePlan } from "../../src/core/types/Trade.js";

const TF = 300_000;

function bar(i: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  const openTime = i * TF;
  return { symbol: "XAUUSD", timeframe: "M5", openTime, open, high, low, close, volume, closeTime: openTime + TF - 1 };
}

function bullishSeries(): Candle[] {
  const lead = [
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
  ];
  lead.push(bar(11, 2024, 2040, 2023, 2038));
  return lead;
}

class TestBridgeClient implements Mt5BridgeClient {
  constructor(
    public connected = true,
    public terminalConnected = true,
    public balance = 25000,
    public equity = 25000,
    public margin = 500,
    public freeMargin = 24500,
    public openPositions: any[] = [],
    public pendingOrders: any[] = []
  ) {}

  async getHealth() {
    return {
      connected: this.connected,
      status: this.connected && this.terminalConnected ? "READY" as const : "DISCONNECTED" as const,
      serverTime: Date.now(),
      latencyMs: 10,
      terminalConnected: this.terminalConnected,
      detail: this.connected && this.terminalConnected ? "MT5 Bridge and Terminal active" : "Disconnected",
    };
  }
  async getAccountInfo() {
    return {
      accountId: "987654",
      balance: this.balance,
      equity: this.equity,
      margin: this.margin,
      freeMargin: this.freeMargin,
      currency: "USD",
      leverage: 200,
      tradingAllowed: true,
      investorMode: false,
    };
  }
  async getSymbolSpec(_symbol: string) {
    return {
      symbol: "XAUUSD",
      digits: 2,
      point: 0.01,
      tickSize: 0.01,
      tickValue: 1.0,
      contractSize: 100,
      volumeMin: 0.01,
      volumeMax: 100.0,
      volumeStep: 0.01,
      tradeMode: "FULL",
      stopsLevel: 0,
      freezeLevel: 0,
      currency: "USD",
    };
  }
  async getQuote(_symbol: string) {
    return { symbol: "XAUUSD", bid: 2037.8, ask: 2038.15, time: Date.now() };
  }
  async getOpenPositions() {
    return this.openPositions;
  }
  async getPendingOrders() {
    return this.pendingOrders;
  }
  async submitOrder(order: any) {
    if (!this.connected || !this.terminalConnected) {
      throw new Error("MT5 terminal disconnected");
    }
    return {
      success: true,
      orderId: "MT5-TICKET-7711",
      status: "ORDER_FILLED",
      volumeFilled: order.volume,
      priceFilled: 2038.15,
      time: Date.now(),
    };
  }
  async closePosition(positionId: string, volume: number) {
    return { success: true, positionId, pnl: 250, volume };
  }
  async modifyProtection(positionId: string, _sl?: number, _tp?: number) {
    return { success: true, positionId };
  }
  async getOrderStatus(orderId: string) {
    return { orderId, status: "ORDER_FILLED" };
  }
}

describe("GP-V4 — Final Phase: MT5 Real Account & Unified Execution Suite", () => {
  let tmpDir: string;
  let configPath: string;
  const log = createConsoleLogger("test-mt5-final");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-mt5-test-"));
    configPath = path.join(tmpDir, "mt5-account.json");
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("1. MT5 account configuration persistence and complete deletion lifecycle", async () => {
    const service = new Mt5Service({}, log, configPath);
    expect(service.isConfigured()).toBe(false);

    // Save configuration
    await service.saveAccount({
      broker: "JustMarkets",
      accountId: "11223344",
      server: "JustMarkets-Live2",
      brokerSymbolXauusd: "XAUUSD",
      bridgeUrl: "http://127.0.0.1:8080",
      password: "secret-password",
    });

    expect(service.isConfigured()).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    // Verify secret password is saved in private file but never in getSanitizedStatus
    const status = await service.getSanitizedStatus();
    expect(status.accountId).toBe("11223344");
    expect(status.server).toBe("JustMarkets-Live2");
    expect((status as any).password).toBeUndefined();

    // Complete Deletion
    await service.deleteAccount();
    expect(service.isConfigured()).toBe(false);
    expect(fs.existsSync(configPath)).toBe(false);

    const postDeleteStatus = await service.getSanitizedStatus();
    expect(postDeleteStatus.status).toBe("NOT_CONFIGURED");
    expect(postDeleteStatus.accountId).toBe("");
  });

  it("2. Real MT5 broker adapter is source of truth for account state", async () => {
    const bridge = new TestBridgeClient(true, true, 50000, 52300, 1000, 51300);
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD", log);

    const acc = await adapter.getAccountInfo();
    expect(acc.accountId).toBe("987654");
    expect(acc.balance).toBe(50000);
    expect(acc.equity).toBe(52300);
    expect(acc.margin).toBe(1000);
    expect(acc.freeMargin).toBe(51300);
    expect(acc.isSimulated).toBe(false);

    const spec = await adapter.getInstrumentSpec("XAUUSD");
    expect(spec.contractSize).toBe(100);
    expect(spec.minLot).toBe(0.01);
    expect(spec.maxLot).toBe(100.0);
  });

  it("3. Canonical Decision Pipeline: SIGNAL MODE vs REAL AUTO MODE produce the EXACT same TradePlan", async () => {
    const candles = bullishSeries();
    const mockAi: any = {
      analyze: async () => ({
        ok: true,
        decision: {
          decision: "TRADE_CANDIDATE",
          confidence: 0.85,
          reason_codes: ["CONFLUENCE_HIGH"],
        },
      }),
    };

    const riskConfig = {
      perTradePct: 1.0,
      dailyLossCapPct: 5.0,
      weeklyLossCapPct: 10.0,
      maxDrawdownPct: 15.0,
      maxOpenTrades: 5,
      netExposureMax: 5.0,
      marginCeilingPct: 50.0,
      accountEquity: 25000,
    };

    const riskEnv = () => ({
      equity: 25000,
      state: { openTrades: 0, netExposureLots: 0, marginUsedPct: 0, dailyLossPct: 0, weeklyLossPct: 0, maxDrawdownPct: 0 },
      killSwitch: "NONE" as const,
    });

    const engines = [new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()];
    const confluence = new ConfluenceEngine(engines);
    const strategy = new StrongCandleStrategy();

    // 1. SIGNAL MODE (ANALYSIS_ONLY)
    const busSignal = new EventBus();
    const cacheSignal = new CandleCache();
    cacheSignal.append({ symbol: "XAUUSD", timeframe: "M5", candles });
    const repoSignal = new InMemoryRepository();
    const setupStoreSignal = new SetupStore();
    const spreadModelSignal = new SpreadSlippageModel(0.35, 0.2, 250);

    let generatedSignalTradePlan: TradePlan | null = null;
    busSignal.on("trade.planned", "test-signal-tracker", (evt: any) => {
      generatedSignalTradePlan = evt.payload;
    });

    const pipelineSignal = new TradingPipeline({
      bus: busSignal,
      cache: cacheSignal,
      confluence,
      strategy,
      setupStore: setupStoreSignal,
      ai: mockAi,
      riskConfig,
      riskEnv,
      repo: repoSignal,
      telegram: { notify: async () => true, isOn: false } as any,
      mode: "ANALYSIS_ONLY",
      log,
      spreadModel: spreadModelSignal,
    });

    const outcomeSignal = await pipelineSignal.onBarClosed("XAUUSD", "M5");
    expect(outcomeSignal.action.kind).toBe("ANALYSIS");
    expect(outcomeSignal.risk?.verdict).toBe("APPROVED");

    // 2. REAL AUTO MODE (AUTO_TRADING with MT5 Broker)
    const bridge = new TestBridgeClient(true, true, 25000, 25000, 0, 25000);
    const mt5Adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD", log);
    const busAuto = new EventBus();
    const cacheAuto = new CandleCache();
    cacheAuto.append({ symbol: "XAUUSD", timeframe: "M5", candles });
    const repoAuto = new InMemoryRepository();
    const setupStoreAuto = new SetupStore();
    const spreadModelAuto = new SpreadSlippageModel(0.35, 0.2, 250);
    const executionEngineAuto = new ExecutionEngine({ broker: mt5Adapter, bus: busAuto, repo: repoAuto, log });

    const pipelineAuto = new TradingPipeline({
      bus: busAuto,
      cache: cacheAuto,
      confluence,
      strategy,
      setupStore: setupStoreAuto,
      ai: mockAi,
      riskConfig,
      riskEnv,
      repo: repoAuto,
      telegram: { notify: async () => true, isOn: false } as any,
      mode: "AUTO_TRADING",
      log,
      spreadModel: spreadModelAuto,
      executionEngine: executionEngineAuto,
    });

    const outcomeAuto = await pipelineAuto.onBarClosed("XAUUSD", "M5");
    expect(outcomeAuto.action.kind).toBe("EXECUTED_BROKER");

    // PROOF OF IDENTITY: Every strategic decision metric is identical
    expect(outcomeSignal.setup!.direction).toBe(outcomeAuto.setup!.direction);
    expect(outcomeSignal.setup!.entry).toBe(outcomeAuto.setup!.entry);
    expect(outcomeSignal.setup!.stopLoss).toBe(outcomeAuto.setup!.stopLoss);
    expect(outcomeSignal.setup!.takeProfit1).toBe(outcomeAuto.setup!.takeProfit1);
    expect(outcomeSignal.setup!.takeProfit2).toBe(outcomeAuto.setup!.takeProfit2);
    expect(outcomeSignal.risk!.lotSize).toBe(outcomeAuto.risk!.lotSize);
    expect(outcomeSignal.risk!.riskAmount).toBe(outcomeAuto.risk!.riskAmount);
    expect(outcomeSignal.risk!.riskPercent).toBe(outcomeAuto.risk!.riskPercent);
  });

  it("4. KillSwitch strictly blocks live MT5 execution", async () => {
    const bridge = new TestBridgeClient(true, true);
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD", log);
    const bus = new EventBus();
    const repo = new InMemoryRepository();
    const killSwitch = new KillSwitch();

    await killSwitch.escalate("L2", "Emergency risk escalation by operator");

    const engine = new ExecutionEngine({ broker: adapter, bus, repo, killSwitch, log });
    const plan: TradePlan = {
      id: "P-KILL-TEST",
      signalId: "SIG-1",
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 2038,
      stopLoss: 2025,
      takeProfit1: 2050,
      takeProfit2: 2065,
      lotSize: 0.5,
      riskAmount: 250,
      mode: "AUTO_TRADING",
      createdAt: Date.now(),
    };

    const res = await engine.executePlan(plan, "AUTO_TRADING");
    expect(res.success).toBe(false);
    expect(res.status).toBe("ORDER_REJECTED");
    expect(res.rejectionReason).toContain("KillSwitch");
  });

  it("5. Execution idempotency prevents double execution of the same TradePlan", async () => {
    const bridge = new TestBridgeClient(true, true);
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD", log);
    const bus = new EventBus();
    const repo = new InMemoryRepository();
    const engine = new ExecutionEngine({ broker: adapter, bus, repo, log });

    const plan: TradePlan = {
      id: "P-IDEMPOTENT-1",
      signalId: "SIG-IDEMP",
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 2038,
      stopLoss: 2025,
      takeProfit1: 2050,
      takeProfit2: 2065,
      lotSize: 0.25,
      riskAmount: 250,
      mode: "AUTO_TRADING",
      createdAt: Date.now(),
    };

    const first = await engine.executePlan(plan, "AUTO_TRADING");
    expect(first.success).toBe(true);
    expect(first.status).toBe("ORDER_FILLED");

    // Second immediate call with same TradePlan ID
    const second = await engine.executePlan(plan, "AUTO_TRADING");
    expect(second.success).toBe(true);
    expect(second.orderId).toBe(first.orderId);
  });

  it("6. Reconciliation Service detects discrepancies against live broker positions", async () => {
    const protection = new SimulatedProtection();
    const reconciliation = new ReconciliationService(protection);

    // Local trade book has trade T-1 with SL 2025
    const localTrades = [
      {
        id: "T-1",
        signalId: "sig-1",
        symbol: "XAUUSD" as const,
        direction: "LONG" as const,
        entry: 2038,
        stopLoss: 2025,
        takeProfit1: 2050,
        takeProfit2: 2065,
        lotSize: 0.5,
        riskAmount: 250,
        mode: "AUTO_TRADING" as const,
        createdAt: Date.now(),
        state: "OPEN" as const,
      },
    ];

    // Venue has no protection placed
    const mismatches = await reconciliation.reconcile(localTrades, 0.5);
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0]?.kind).toBe("MISSING_PROTECTION");

    // Repair places venue protection
    const repaired = await reconciliation.repair(localTrades);
    expect(repaired).toBe(1);

    const postRepair = await reconciliation.reconcile(localTrades, 0.5);
    expect(postRepair).toHaveLength(0);
  });

  it("7. Disconnected MT5 broker safely blocks live order submission", async () => {
    const disconnectedBridge = new TestBridgeClient(false, false);
    const adapter = new JustMarketsMt5Adapter(disconnectedBridge, "XAUUSD", log);
    const bus = new EventBus();
    const repo = new InMemoryRepository();
    const engine = new ExecutionEngine({ broker: adapter, bus, repo, log });

    const plan: TradePlan = {
      id: "P-DISCONNECTED-TEST",
      signalId: "SIG-DISC",
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 2038,
      stopLoss: 2025,
      takeProfit1: 2050,
      takeProfit2: 2065,
      lotSize: 0.25,
      riskAmount: 250,
      mode: "AUTO_TRADING",
      createdAt: Date.now(),
    };

    const res = await engine.executePlan(plan, "AUTO_TRADING");
    expect(res.success).toBe(false);
    expect(res.status).toBe("ORDER_REJECTED");
    expect(res.rejectionReason).toContain("BLOCKED");
  });

  it("8. AI failure in AUTO_TRADING mode blocks execution and cannot bypass RiskEngine", async () => {
    const candles = bullishSeries();
    const failingAi: any = {
      analyze: async () => ({
        ok: false,
        failure: {
          kind: "CIRCUIT_OPEN",
          message: "Novita AI service temporarily unavailable",
        },
      }),
    };

    const bridge = new TestBridgeClient(true, true);
    const mt5Adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD", log);
    const bus = new EventBus();
    const cache = new CandleCache();
    cache.append({ symbol: "XAUUSD", timeframe: "M5", candles });
    const repo = new InMemoryRepository();
    const setupStore = new SetupStore();
    const spreadModel = new SpreadSlippageModel(0.35, 0.2, 250);
    const executionEngine = new ExecutionEngine({ broker: mt5Adapter, bus, repo, log });

    const pipeline = new TradingPipeline({
      bus,
      cache,
      confluence: new ConfluenceEngine([new StructureEngine(), new LiquidityEngine(), new PriceActionEngine()]),
      strategy: new StrongCandleStrategy(),
      setupStore,
      ai: failingAi,
      riskConfig: { perTradePct: 1, dailyLossCapPct: 5, weeklyLossCapPct: 10, maxDrawdownPct: 15, maxOpenTrades: 5, netExposureMax: 5, marginCeilingPct: 50, accountEquity: 25000 },
      riskEnv: () => ({ equity: 25000, state: { openTrades: 0, netExposureLots: 0, marginUsedPct: 0, dailyLossPct: 0, weeklyLossPct: 0, maxDrawdownPct: 0 }, killSwitch: "NONE" }),
      repo,
      telegram: { notify: async () => true, isOn: false } as any,
      mode: "AUTO_TRADING",
      log,
      spreadModel,
      executionEngine,
    });

    const outcome = await pipeline.onBarClosed("XAUUSD", "M5");
    expect(outcome.action.kind).toBe("AI_BLOCKED");
    expect(outcome.reasons[0]).toContain("AI unavailable");
  });

  it("9. Mt5Service DELETE operation completely unlinks config file and invalidates connection state", async () => {
    const tmpFile = path.join(os.tmpdir(), `delete-test-account-${Date.now()}.json`);
    const service = new Mt5Service({}, log, tmpFile);

    await service.saveAccount({
      enabled: true,
      broker: "JustMarkets",
      accountId: "11223344",
      server: "JustMarkets-Live",
      bridgeUrl: "http://127.0.0.1:9099",
      password: "secret_broker_password",
    });

    expect(fs.existsSync(tmpFile)).toBe(true);
    expect(service.isConfigured()).toBe(true);

    await service.deleteAccount();

    expect(fs.existsSync(tmpFile)).toBe(false);
    expect(service.isConfigured()).toBe(false);
    const status = await service.getSanitizedStatus();
    expect(status.status).toBe("NOT_CONFIGURED");
    expect(status.accountId).toBe("");
    expect(status.bridgeUrl).toBe("");
    expect((status as any).password).toBeUndefined();
  });
});
