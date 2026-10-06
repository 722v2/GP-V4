import { describe, expect, it, vi } from "vitest";
import { NullRepository } from "../../src/persistence/Persistence.js";
import { SupabaseRepository } from "../../src/persistence/SupabaseRepository.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { RiskStateTracker } from "../../src/risk/RiskStateTracker.js";
import { SetupStore } from "../../src/strategies/SetupStore.js";
import { SimulatedProtection } from "../../src/execution/BrokerProtection.js";
import { ReconciliationService, runStartupReconciliation } from "../../src/safety/Reconciliation.js";
import { SimulatedPositionManager } from "../../src/execution/SimulatedPositionManager.js";
import { IdempotencyGuard } from "../../src/safety/IdempotencyGuard.js";
import { createConsoleLogger } from "../../src/core/logging/Logger.js";
import type { Trade } from "../../src/core/types/Trade.js";
import type { Setup } from "../../src/core/types/Setup.js";
import type { KillSwitchState } from "../../src/risk/KillSwitch.js";

const log = createConsoleLogger("test");

function makeTrade(id: string, state: Trade["state"] = "OPEN", overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    signalId: `sig:${id}`,
    symbol: "XAUUSD",
    direction: "LONG",
    entry: 2000,
    stopLoss: 1990,
    takeProfit1: 2010,
    takeProfit2: 2020,
    lotSize: 0.1,
    riskAmount: 100,
    mode: "PAPER_TRADING",
    createdAt: 1000,
    state,
    openedAt: 1000,
    ...overrides,
  };
}

function makeSetup(id: string, state: Setup["state"] = "ACTIVE"): Setup {
  return {
    id,
    strategyId: "strong-candle",
    symbol: "XAUUSD",
    timeframe: "M5",
    direction: "LONG",
    barOpenTime: 1000,
    createdAt: 1000,
    state,
    entry: 2000,
    stopLoss: 1990,
    takeProfit1: 2010,
    takeProfit2: 2020,
    invalidationPrice: 1990,
    rationale: "test setup",
    evidence: [],
  };
}

describe("A5: Persistence Completeness and Runtime Reconciliation", () => {
  describe("NullRepository safety", () => {
    it("safely returns empty collections and null state without throwing", async () => {
      const repo = new NullRepository();
      expect(await repo.getOpenTrades()).toEqual([]);
      expect(await repo.getClosedTrades()).toEqual([]);
      expect(await repo.getActiveSetups()).toEqual([]);
      expect(await repo.getKillSwitchState()).toBeNull();
      await expect(repo.saveKillSwitchState({ level: "L2", reason: "r", updatedAt: 1, updatedBy: "u", active: true })).resolves.toBeUndefined();
    });
  });

  describe("SupabaseRepository reads & failure handling", () => {
    it("returns empty collections when unconfigured", async () => {
      const repo = new SupabaseRepository({ url: "", serviceKey: "" }, log);
      expect(await repo.getOpenTrades()).toEqual([]);
      expect(await repo.getClosedTrades()).toEqual([]);
      expect(await repo.getActiveSetups()).toEqual([]);
      expect(await repo.getKillSwitchState()).toBeNull();
    });

    it("surfaces persistence errors clearly instead of swallowing them", async () => {
      const repo = new SupabaseRepository({ url: "https://example.com", serviceKey: "key" }, log);
      (repo as any).db = () => ({
        from: () => ({
          select: () => ({
            in: async () => ({ error: new Error("db query failed"), data: null }),
            eq: () => ({
              maybeSingle: async () => ({ error: new Error("db query failed"), data: null }),
            }),
          }),
        }),
      });
      await expect(repo.getOpenTrades()).rejects.toThrow(/Failed to load open trades/);
      await expect(repo.getActiveSetups()).rejects.toThrow(/Failed to load active setups/);
      await expect(repo.getKillSwitchState()).rejects.toThrow(/Failed to load kill switch state/);
    });
  });

  describe("KillSwitch persistence and restoration", () => {
    it("persists state changes and restores L2/L3 without silent downgrade", async () => {
      let persistedState: KillSwitchState | null = null;
      const mockRepo = {
        name: "mock",
        saveSetup: vi.fn(),
        saveAiDecision: vi.fn(),
        saveTradePlan: vi.fn(),
        updateTrade: vi.fn(),
        getOpenTrades: async () => [],
        getClosedTrades: async () => [],
        getActiveSetups: async () => [],
        getKillSwitchState: async () => persistedState,
        saveKillSwitchState: async (s: KillSwitchState) => {
          persistedState = s;
        },
      };

      const ks1 = new KillSwitch(async (s) => mockRepo.saveKillSwitchState(s));
      await ks1.escalate("L2", "high daily loss", "risk-engine");
      expect(persistedState).not.toBeNull();
      expect((persistedState as KillSwitchState | null)?.level).toBe("L2");

      // Simulate process restart: new KillSwitch instance restored from repo
      const ks2 = new KillSwitch(async (s) => mockRepo.saveKillSwitchState(s));
      const saved = await mockRepo.getKillSwitchState();
      if (saved) ks2.restore(saved);

      expect(ks2.level).toBe("L2");
      expect(ks2.current.reason).toBe("high daily loss");

      // Attempt lower escalation (L1) does not downgrade monotonic state
      await ks2.escalate("L1", "lower warning");
      expect(ks2.level).toBe("L2");
    });
  });

  describe("SetupStore restoration", () => {
    it("restores active setups and rejects terminal setups", () => {
      const store = new SetupStore();
      const s1 = makeSetup("s1", "NEW");
      const s2 = makeSetup("s2", "ACTIVE");
      const s3 = makeSetup("s3", "UPDATED");
      const sTerminal1 = makeSetup("s4", "TRIGGERED");
      const sTerminal2 = makeSetup("s5", "EXPIRED");
      const sTerminal3 = makeSetup("s6", "INVALIDATED");
      const sTerminal4 = makeSetup("s7", "CLOSED");

      store.restore([s1, s2, s3, sTerminal1, sTerminal2, sTerminal3, sTerminal4]);

      expect(store.get("s1")?.state).toBe("NEW");
      expect(store.get("s2")?.state).toBe("ACTIVE");
      expect(store.get("s3")?.state).toBe("UPDATED");
      expect(store.get("s4")).toBeUndefined();
      expect(store.get("s5")).toBeUndefined();
      expect(store.get("s6")).toBeUndefined();
      expect(store.get("s7")).toBeUndefined();
    });
  });

  describe("Trade lifecycle & RiskState reconstruction", () => {
    it("restores open positions, computes net exposure and margins in RiskStateTracker", () => {
      const tracker = new RiskStateTracker(10_000);
      const openTrades: Trade[] = [
        makeTrade("t1", "OPEN", { lotSize: 0.1, direction: "LONG", entry: 2000 }),
        makeTrade("t2", "TP1_HIT", { lotSize: 0.05, direction: "LONG", entry: 2010 }),
      ];

      for (const t of openTrades) {
        tracker.recordTradeOpened({
          id: t.id,
          symbol: t.symbol,
          direction: t.direction,
          entry: t.entry,
          lotSize: t.lotSize,
          openedAt: t.openedAt ?? t.createdAt,
        });
      }

      expect(tracker.openPositionsCount).toBe(2);
      expect(tracker.state.openTrades).toBe(2);
      expect(tracker.state.netExposureLots).toBe(0.15);
      expect(tracker.state.marginUsedPct).toBeGreaterThan(0);
    });

    it("restores closed trade P&L and updates loss & drawdown metrics", () => {
      const tracker = new RiskStateTracker(10_000);
      // Restore a loss of $300 from earlier today
      tracker.recordRealizedPnl(-300, Date.now());

      expect(tracker.currentEquity).toBe(9700);
      expect(tracker.dailyRealizedPnl).toBe(-300);
      expect(tracker.state.dailyLossPct).toBe(3);
      expect(tracker.state.maxDrawdownPct).toBe(3);
    });
  });

  describe("Startup Reconciliation & Safety Gating", () => {
    it("auto-repairs missing protective orders on open trades and allows healthy startup", async () => {
      const openTrade = makeTrade("t1", "OPEN", { stopLoss: 1990, takeProfit1: 2010 });
      const mockRepo = {
        name: "mock",
        saveSetup: vi.fn(),
        saveAiDecision: vi.fn(),
        saveTradePlan: vi.fn(),
        saveSignal: vi.fn().mockResolvedValue({ accepted: true, duplicate: false }),
        updateTrade: vi.fn(),
        getOpenTrades: async () => [openTrade],
        getClosedTrades: async () => [],
        getActiveSetups: async () => [makeSetup("s1", "ACTIVE")],
        getSignals: async () => [],
        getKillSwitchState: async () => null,
        saveKillSwitchState: vi.fn(),
      };

      const protection = new SimulatedProtection();
      const reconciliation = new ReconciliationService(protection);
      const killSwitch = new KillSwitch();
      const riskTracker = new RiskStateTracker(10_000);
      const setupStore = new SetupStore();
      const positionManager = new SimulatedPositionManager({ bus: { on: vi.fn(), publish: vi.fn() } as any, repo: mockRepo as any, protection });
      const idempotency = new IdempotencyGuard();

      const result = await runStartupReconciliation({
        repo: mockRepo,
        killSwitch,
        riskTracker,
        setupStore,
        positionManager,
        protection,
        reconciliation,
        idempotency,
        log,
      });

      expect(result.success).toBe(true);
      expect(result.openTradesRestored).toBe(1);
      expect(result.activeSetupsRestored).toBe(1);
      expect(result.repairsAttempted).toBe(1);
      expect(result.remainingMismatches).toHaveLength(0);
      expect(killSwitch.level).toBe("NONE");

      // Verify protection was placed on venue
      const orders = await protection.list();
      expect(orders).toHaveLength(1);
      expect(orders[0]?.tradeId).toBe("t1");
      expect(orders[0]?.stopLoss).toBe(1990);

      // Verify position manager has trade restored
      expect(positionManager.getPosition("t1")?.state).toBe("OPEN");
    });

    it("escalates KillSwitch to L2 when unrepairable price drift mismatch occurs", async () => {
      const openTrade = makeTrade("t1", "OPEN", { stopLoss: 1990, takeProfit1: 2010 });
      const mockRepo = {
        name: "mock",
        saveSetup: vi.fn(),
        saveAiDecision: vi.fn(),
        saveTradePlan: vi.fn(),
        saveSignal: vi.fn().mockResolvedValue({ accepted: true, duplicate: false }),
        updateTrade: vi.fn(),
        getOpenTrades: async () => [openTrade],
        getClosedTrades: async () => [],
        getActiveSetups: async () => [],
        getSignals: async () => [],
        getKillSwitchState: async () => null,
        saveKillSwitchState: vi.fn(),
      };

      const protection = new SimulatedProtection();
      // Venue order has price drift (SL 1950 vs trade SL 1990, diff = 40 > tolerance 0.5)
      await protection.protect({
        tradeId: "t1",
        symbol: "XAUUSD",
        side: "LONG",
        stopLoss: 1950,
        takeProfit: 2010,
      });

      const reconciliation = new ReconciliationService(protection);
      const killSwitch = new KillSwitch();
      const riskTracker = new RiskStateTracker(10_000);
      const setupStore = new SetupStore();

      const result = await runStartupReconciliation({
        repo: mockRepo,
        killSwitch,
        riskTracker,
        setupStore,
        protection,
        reconciliation,
        tolerance: 0.5,
        log,
      });

      // Must fail and escalate KillSwitch to block new order origination
      expect(result.success).toBe(false);
      expect(result.remainingMismatches).toHaveLength(1);
      expect(result.remainingMismatches[0]?.kind).toBe("PRICE_DRIFT");
      expect(killSwitch.level).toBe("L2");
      expect(result.killSwitchLevel).toBe("L2");
    });
  });
});
