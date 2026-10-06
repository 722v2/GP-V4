import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../../src/core/events/EventBus.js";
import { SimulatedPositionManager } from "../../src/execution/SimulatedPositionManager.js";
import { SimulatedProtection } from "../../src/execution/BrokerProtection.js";
import { SpreadSlippageModel } from "../../src/execution/TradeLifecycle.js";
import { RiskStateTracker } from "../../src/risk/RiskStateTracker.js";
import type { Candle } from "../../src/core/types/Candle.js";
import type { TradePlan, Trade } from "../../src/core/types/Trade.js";
import type { PersistenceRepository } from "../../src/persistence/Persistence.js";

function bar(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return {
    symbol: "XAUUSD",
    timeframe: "M5",
    openTime,
    closeTime: openTime + 300_000,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

function makeTradePlan(id = "p1", entry = 2000, stopLoss = 1990, takeProfit1 = 2010, takeProfit2 = 2020): TradePlan {
  return {
    id,
    signalId: `sig:${id}`,
    symbol: "XAUUSD",
    direction: "LONG",
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    lotSize: 0.05,
    riskAmount: 50,
    mode: "PAPER_TRADING",
    createdAt: 1000,
  };
}

function createMockRepo(onUpdate?: (trade: Trade) => void): PersistenceRepository {
  return {
    name: "mock",
    saveTradePlan: vi.fn(),
    saveSignal: vi.fn().mockResolvedValue({ accepted: true, duplicate: false }),
    saveSetup: vi.fn(),
    saveAiDecision: vi.fn(),
    updateTrade: vi.fn().mockImplementation(async (trade: Trade) => {
      if (onUpdate) onUpdate(trade);
    }),
    getOpenTrades: vi.fn().mockResolvedValue([]),
    getClosedTrades: vi.fn().mockResolvedValue([]),
    getActiveSetups: vi.fn().mockResolvedValue([]),
    getSignals: vi.fn().mockResolvedValue([]),
    getKillSwitchState: vi.fn().mockResolvedValue(null),
    saveKillSwitchState: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SimulatedPositionManager", () => {
  it("transitions a trade from SUBMITTED to OPEN upon submission", async () => {
    const bus = new EventBus();
    const updatedTrades: Trade[] = [];
    const repo = createMockRepo((trade) => updatedTrades.push(trade));
    const protection = new SimulatedProtection();
    const spreadModel = new SpreadSlippageModel(0.35, 0.20, 250);

    const manager = new SimulatedPositionManager({
      bus,
      repo,
      protection,
      spreadModel,
    });
    manager.attachToBus();

    const plan = makeTradePlan("p1", 2000);
    const adjustedEntry = spreadModel.adjustedFill("LONG", 2000); // 2000.55

    await bus.publish({
      name: "trade.submitted",
      timestamp: 1000,
      payload: {
        tradeId: plan.id,
        lotSize: plan.lotSize,
        entry: adjustedEntry,
        symbol: plan.symbol,
        direction: plan.direction,
        stopLoss: plan.stopLoss,
        takeProfit1: plan.takeProfit1,
        takeProfit2: plan.takeProfit2,
        plan,
      },
    });

    expect(manager.openCount).toBe(1);
    const pos = manager.getPosition("p1");
    expect(pos).toBeDefined();
    expect(pos?.state).toBe("OPEN");
    expect(pos?.entry).toBeCloseTo(2000.55, 2);
    expect(pos?.openedAt).toBe(1000);

    // Verify protection was registered
    const protections = await protection.list();
    expect(protections).toHaveLength(1);
    expect(protections[0]?.tradeId).toBe("p1");
    expect(protections[0]?.stopLoss).toBe(1990);

    // Verify persistence updateTrade was called with OPEN state
    expect(updatedTrades).toHaveLength(1);
    expect(updatedTrades[0]?.state).toBe("OPEN");
    expect(updatedTrades[0]?.entry).toBeCloseTo(2000.55, 2);
  });

  it("enforces no same-bar lookahead: entry bar cannot trigger SL/TP", async () => {
    const bus = new EventBus();
    const repo = createMockRepo();
    const manager = new SimulatedPositionManager({ bus, repo });
    manager.attachToBus();

    const plan = makeTradePlan("p1");
    await bus.publish({
      name: "trade.submitted",
      timestamp: 1000,
      payload: {
        tradeId: plan.id,
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

    // Feeding the same bar timestamp (1000) that would otherwise breach SL
    const sameBar = bar(1000, 2000, 2005, 1985, 1989);
    await manager.onCandleClosed("XAUUSD", sameBar);

    // Position must still be OPEN because same bar cannot evaluate
    expect(manager.getPosition("p1")?.state).toBe("OPEN");
  });

  it("subsequent candle triggers SL closure, emits trade.closed and updates RiskStateTracker", async () => {
    const bus = new EventBus();
    const tracker = new RiskStateTracker(10_000, { now: () => 2000 });
    tracker.attachToBus(bus);

    const closedEvents: unknown[] = [];
    bus.on("trade.closed", "test", (e) => {
      closedEvents.push(e.payload);
    });

    const repo = createMockRepo();
    const protection = new SimulatedProtection();
    const spreadModel = new SpreadSlippageModel(0.35, 0.20, 250);

    const manager = new SimulatedPositionManager({
      bus,
      repo,
      protection,
      spreadModel,
    });
    manager.attachToBus();

    const plan = makeTradePlan("p1", 2000, 1990);
    const entry = spreadModel.adjustedFill("LONG", 2000); // 2000.55

    await bus.publish({
      name: "trade.submitted",
      timestamp: 1000,
      payload: {
        tradeId: plan.id,
        lotSize: plan.lotSize,
        entry,
        symbol: plan.symbol,
        direction: plan.direction,
        stopLoss: plan.stopLoss,
        takeProfit1: plan.takeProfit1,
        takeProfit2: plan.takeProfit2,
        plan,
      },
    });

    // Verify RiskStateTracker recorded position open
    expect(tracker.state.openTrades).toBe(1);
    expect(tracker.state.netExposureLots).toBe(0.05);

    // Subsequent candle (openTime: 1300000 > 1000) breaches SL at 1990
    const slCandle = bar(1_300_000, 1995, 1996, 1985, 1988);
    await manager.onCandleClosed("XAUUSD", slCandle);

    // Position is closed and removed from manager
    expect(manager.openCount).toBe(0);

    // Protective orders released
    expect(await protection.list()).toHaveLength(0);

    // trade.closed event was published
    expect(closedEvents).toHaveLength(1);
    const closedPayload = closedEvents[0] as { tradeId: string; realizedPnl: number; exitReason: string };
    expect(closedPayload.tradeId).toBe("p1");
    expect(closedPayload.exitReason).toBe("stop loss");
    // P&L: (1989.45 - 2000.55) * 100 * 0.05 = -11.10 * 5 = -55.50
    expect(closedPayload.realizedPnl).toBeCloseTo(-55.50, 2);

    // RiskStateTracker updated: 0 open trades, daily loss recorded
    expect(tracker.state.openTrades).toBe(0);
    expect(tracker.state.netExposureLots).toBe(0);
    expect(tracker.state.dailyLossPct).toBeGreaterThan(0.5);
  });

  it("handles TP1 progression followed by TP2 closure", async () => {
    const bus = new EventBus();
    const updatedTrades: Trade[] = [];
    const repo = createMockRepo((trade) => updatedTrades.push(trade));
    const manager = new SimulatedPositionManager({ bus, repo });
    manager.attachToBus();

    const plan = makeTradePlan("p_win", 2000, 1990, 2010, 2020);
    await bus.publish({
      name: "trade.submitted",
      timestamp: 1000,
      payload: {
        tradeId: plan.id,
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

    // Bar 1: hits TP1 (2010)
    const tp1Candle = bar(2000, 2002, 2012, 1998, 2011);
    await manager.onCandleClosed("XAUUSD", tp1Candle);

    expect(manager.openCount).toBe(1);
    expect(manager.getPosition("p_win")?.state).toBe("TP1_HIT");
    expect(updatedTrades.some((t) => t.state === "TP1_HIT")).toBe(true);

    // Bar 2: hits TP2 (2020) -> terminal closure
    const tp2Candle = bar(3000, 2011, 2025, 2009, 2022);
    await manager.onCandleClosed("XAUUSD", tp2Candle);

    expect(manager.openCount).toBe(0);
    const lastUpdate = updatedTrades[updatedTrades.length - 1];
    expect(lastUpdate?.state).toBe("TP2_HIT");
    expect(lastUpdate?.realizedPnl!).toBeGreaterThan(0);
  });

  it("tracks multiple open simulated trades independently", async () => {
    const bus = new EventBus();
    const repo = createMockRepo();
    const manager = new SimulatedPositionManager({ bus, repo });
    manager.attachToBus();

    // Submit trade 1 (LONG)
    const plan1 = makeTradePlan("t1", 2000, 1990, 2010, 2020);
    await bus.publish({
      name: "trade.submitted",
      timestamp: 1000,
      payload: {
        tradeId: plan1.id,
        lotSize: 0.05,
        entry: 2000,
        symbol: "XAUUSD",
        direction: "LONG",
        stopLoss: 1990,
        takeProfit1: 2010,
        takeProfit2: 2020,
        plan: plan1,
      },
    });

    // Submit trade 2 (SHORT)
    const plan2 = { ...makeTradePlan("t2", 2000, 2010, 1990, 1980), direction: "SHORT" as const };
    await bus.publish({
      name: "trade.submitted",
      timestamp: 1000,
      payload: {
        tradeId: plan2.id,
        lotSize: 0.05,
        entry: 2000,
        symbol: "XAUUSD",
        direction: "SHORT",
        stopLoss: 2010,
        takeProfit1: 1990,
        takeProfit2: 1980,
        plan: plan2,
      },
    });

    expect(manager.openCount).toBe(2);

    // Candle rises to 2015: Long hits TP1 (2010), Short gets stopped out at SL (2010)
    const candle = bar(2000, 2000, 2015, 1999, 2014);
    await manager.onCandleClosed("XAUUSD", candle);

    expect(manager.openCount).toBe(1);
    expect(manager.getPosition("t1")?.state).toBe("TP1_HIT");
    expect(manager.getPosition("t2")).toBeUndefined(); // t2 closed at SL
  });
});
