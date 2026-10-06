import { describe, expect, it, vi } from "vitest";
import { InMemoryRepository } from "../../src/persistence/Persistence.js";
import { ExecutionEngine } from "../../src/execution/ExecutionEngine.js";
import { PaperBrokerAdapter } from "../../src/execution/broker/PaperBrokerAdapter.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { DEFAULT_XAUUSD_SPEC } from "../../src/risk/InstrumentSpec.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { TradePlan } from "../../src/core/types/Trade.js";
import { ExperienceMemory, type TradeExperienceRecord } from "../../src/core/memory/ExperienceMemory.js";
import { SimulatedPositionManager } from "../../src/execution/SimulatedPositionManager.js";
import { SimulatedProtection } from "../../src/execution/BrokerProtection.js";
import { SpreadSlippageModel } from "../../src/execution/TradeLifecycle.js";
import { runStartupReconciliation, ReconciliationService } from "../../src/safety/Reconciliation.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { RiskStateTracker } from "../../src/risk/RiskStateTracker.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { PromotionGateEngine } from "../../src/safety/PromotionGates.js";
import { loadAppConfig } from "../../src/config/env.js";

const log = createConsoleLogger("test");

describe("GP-V4 — Persistence Gap & Integration Coverage", () => {
  it("A. ExperienceMemory saves closed trade outcomes and restores them on restart", async () => {
    const repo = new InMemoryRepository();
    const expMemory1 = new ExperienceMemory();
    const bus = new EventBus();
    const protection = new SimulatedProtection();
    const spreadModel = new SpreadSlippageModel(0.35, 0.20, 250);

    const posMgr = new SimulatedPositionManager({
      bus,
      repo,
      protection,
      spreadModel,
      experienceMemory: expMemory1,
      log,
    });
    posMgr.attachToBus();

    const plan: TradePlan = {
      id: "tr_exp_1",
      signalId: "sig_1",
      setupId: "setup_exp_1",
      symbol: "XAUUSD",
      timeframe: "M5",
      direction: "LONG",
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 1.0,
      riskAmount: 100,
      mode: "ANALYSIS_ONLY",
      createdAt: 1000,
    };

    // Open trade via trade.submitted event
    await bus.publish({
      name: "trade.submitted",
      timestamp: 1000,
      payload: {
        tradeId: plan.id,
        orderId: "ord_exp_1",
        lotSize: plan.lotSize,
        entry: plan.entry,
        symbol: plan.symbol,
        direction: plan.direction,
        stopLoss: plan.stopLoss,
        takeProfit1: plan.takeProfit1,
        takeProfit2: plan.takeProfit2,
        plan,
      },
    });
    expect(posMgr.openCount).toBe(1);

    // Candle 1: Open bar (no same-bar lookahead trigger)
    await bus.publish({
      name: "candle.closed",
      timestamp: 2000,
      payload: {
        symbol: "XAUUSD",
        timeframe: "M5",
        openTime: 2000,
        candle: { symbol: "XAUUSD", timeframe: "M5", openTime: 2000, closeTime: 2299, open: 2000, high: 2005, low: 1995, close: 2002, volume: 10 },
      },
    });

    // Candle 2: TP2 trigger bar -> closes trade with WIN
    await bus.publish({
      name: "candle.closed",
      timestamp: 3000,
      payload: {
        symbol: "XAUUSD",
        timeframe: "M5",
        openTime: 3000,
        candle: { symbol: "XAUUSD", timeframe: "M5", openTime: 3000, closeTime: 3299, open: 2002, high: 2025, low: 2001, close: 2022, volume: 10 },
      },
    });

    expect(posMgr.openCount).toBe(0);

    // Verify ExperienceRecord was created in memory and saved to repo
    const savedRecords = await repo.getExperienceRecords();
    expect(savedRecords.length).toBeGreaterThan(0);
    expect(savedRecords[0]?.setupId).toBe("setup_exp_1");
    expect(savedRecords[0]?.outcome).toBe("WIN");

    // Simulate process restart with a fresh ExperienceMemory instance
    const expMemory2 = new ExperienceMemory();
    expect(expMemory2.all()).toHaveLength(0);

    const killSwitch = new KillSwitch();
    const riskTracker = new RiskStateTracker(10_000);
    const setupStore = new SetupStore();
    const reconciliation = new ReconciliationService(protection);

    await runStartupReconciliation({
      repo,
      killSwitch,
      riskTracker,
      setupStore,
      protection,
      reconciliation,
      experienceMemory: expMemory2,
      log,
    });

    // ExperienceMemory restored from repo
    expect(expMemory2.all()).toHaveLength(1);
    expect(expMemory2.all()[0]?.setupId).toBe("setup_exp_1");
  });

  it("B & C. Orders and Executions are persisted and checked for idempotency on restart", async () => {
    const repo = new InMemoryRepository();
    const bus = new EventBus();
    const broker = new PaperBrokerAdapter({ initialBalance: 10000 });

    const engine1 = new ExecutionEngine({
      broker,
      bus,
      repo,
      instrumentSpec: DEFAULT_XAUUSD_SPEC,
      log,
    });

    const plan: TradePlan = {
      id: "tr_ord_1",
      signalId: "sig_ord_1",
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 2000,
      stopLoss: 1990,
      takeProfit1: 2010,
      takeProfit2: 2020,
      lotSize: 0.1,
      riskAmount: 10,
      mode: "PAPER_TRADING",
      createdAt: 1000,
    };

    const res1 = await engine1.executePlan(plan, "PAPER_TRADING");
    expect(res1.status).toBe("ORDER_FILLED");

    // Verify order and execution were saved in repo
    const savedOrder = await repo.getOrder(`CL-ORD-${plan.id}`);
    expect(savedOrder).not.toBeNull();
    expect(savedOrder?.clientOrderId).toBe("CL-ORD-tr_ord_1");
    expect(savedOrder?.status).toBe("ORDER_FILLED");

    // Simulate restart with NEW ExecutionEngine instance
    const engine2 = new ExecutionEngine({
      broker,
      bus,
      repo,
      instrumentSpec: DEFAULT_XAUUSD_SPEC,
      log,
    });

    // Executing same plan again on fresh engine should hit DB idempotency check and skip submission
    const res2 = await engine2.executePlan(plan, "PAPER_TRADING");
    expect(res2.clientOrderId).toBe("CL-ORD-tr_ord_1");
    expect(res2.status).toBe("ORDER_FILLED");
  });

  it("D. Reconciliation events are recorded and saved to repository", async () => {
    const repo = new InMemoryRepository();
    const killSwitch = new KillSwitch();
    const riskTracker = new RiskStateTracker(10_000);
    const setupStore = new SetupStore();
    const protection = new SimulatedProtection();
    const reconciliation = new ReconciliationService(protection);

    const spySaveRec = vi.spyOn(repo, "saveReconciliationEvent");

    const res = await runStartupReconciliation({
      repo,
      killSwitch,
      riskTracker,
      setupStore,
      protection,
      reconciliation,
      log,
    });

    expect(res.success).toBe(true);
    expect(spySaveRec).toHaveBeenCalled();
  });

  it("E. PromotionGates evaluations are persisted to repository", async () => {
    const repo = new InMemoryRepository();
    const killSwitch = new KillSwitch();
    const broker = new PaperBrokerAdapter({ initialBalance: 10000 });
    const config = loadAppConfig();

    const promotionEngine = new PromotionGateEngine(config, repo, killSwitch, broker);
    const report = await promotionEngine.evaluateAll();

    expect(report.overallState).toBeDefined();

    const savedReport = await repo.getLatestPromotionReport();
    expect(savedReport).not.toBeNull();
    expect(savedReport?.overallState).toBe(report.overallState);
    expect(savedReport?.gates).toBeDefined();
  });
});
