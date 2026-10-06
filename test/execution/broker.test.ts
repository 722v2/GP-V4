import { describe, expect, it } from "vitest";
import { PaperBrokerAdapter } from "../../src/execution/broker/PaperBrokerAdapter.js";
import { NullBrokerAdapter } from "../../src/execution/broker/NullBrokerAdapter.js";
import { ExecutionEngine } from "../../src/execution/ExecutionEngine.js";
import { SpreadSlippageModel } from "../../src/execution/TradeLifecycle.js";
import { DEFAULT_XAUUSD_SPEC } from "../../src/risk/InstrumentSpec.js";
import { EventBus } from "../../src/core/events/EventBus.js";
import { InMemoryRepository } from "../../src/persistence/Persistence.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import type { TradePlan } from "../../src/core/types/Trade.js";

describe("Broker Adapters & Execution Boundary Suite", () => {
  describe("PaperBrokerAdapter", () => {
    it("reports healthy simulated status with capabilities", async () => {
      const adapter = new PaperBrokerAdapter({ initialBalance: 10_000 });
      const h = await adapter.getHealth();
      expect(h.connected).toBe(true);
      expect(h.isSimulated).toBe(true);
      expect(h.capabilities.supportsMarketOrders).toBe(true);
      expect(h.capabilities.supportsBrokerSideProtection).toBe(true);
    });

    it("fills market orders with spread and slippage and tracks positions", async () => {
      const model = new SpreadSlippageModel(0.35, 0.2, 250);
      const adapter = new PaperBrokerAdapter({ initialBalance: 10_000, spreadModel: model });

      const res = await adapter.submitOrder({
        clientOrderId: "CL-1",
        tradeId: "T-100",
        symbol: "XAUUSD",
        direction: "LONG",
        lotSize: 0.1,
        orderType: "MARKET",
        targetPrice: 2050.0,
        stopLoss: 2040.0,
        takeProfit1: 2070.0,
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe("ORDER_FILLED");
      expect(res.fillPrice).toBe(2050.55); // 2050 + 0.35 + 0.2
      expect(res.protectionStatus).toBe("PROTECTED");

      const positions = await adapter.getOpenPositions();
      expect(positions).toHaveLength(1);
      const pos0 = positions[0]!;
      expect(pos0.symbol).toBe("XAUUSD");
      expect(pos0.side).toBe("LONG");
      expect(pos0.lotSize).toBe(0.1);
    });

    it("closes positions and calculates realized P&L accurately", async () => {
      const adapter = new PaperBrokerAdapter({ initialBalance: 10_000 });
      const fill = await adapter.submitOrder({
        clientOrderId: "CL-2",
        tradeId: "T-101",
        symbol: "XAUUSD",
        direction: "LONG",
        lotSize: 0.1,
        orderType: "MARKET",
        targetPrice: 2000.0,
        stopLoss: 1990.0,
        takeProfit1: 2020.0,
      });

      const positions = await adapter.getOpenPositions();
      const posId = positions[0]!.positionId;

      const closed = await adapter.closePosition(posId, 0.1, 2020.0);
      expect(closed.success).toBe(true);
      expect(closed.realizedPnl).toBe(200.0); // (2020 - 2000) * 100 * 0.1

      const info = await adapter.getAccountInfo();
      expect(info.balance).toBe(10_200.0);
    });

    it("rejects orders with out-of-bounds lot sizes", async () => {
      const adapter = new PaperBrokerAdapter({ initialBalance: 10_000 });
      const res = await adapter.submitOrder({
        clientOrderId: "CL-3",
        tradeId: "T-102",
        symbol: "XAUUSD",
        direction: "LONG",
        lotSize: 500.0, // Exceeds maxLot (10.0)
        orderType: "MARKET",
        stopLoss: 2000,
        takeProfit1: 2050,
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe("ORDER_REJECTED");
      expect(res.rejectionReason).toContain("outside bounds");
    });
  });

  describe("NullBrokerAdapter", () => {
    it("reports unconnected health and rejects live order submissions", async () => {
      const adapter = new NullBrokerAdapter();
      const h = await adapter.getHealth();
      expect(h.connected).toBe(false);
      expect(h.status).toBe("NOT_CONFIGURED");

      const res = await adapter.submitOrder({
        clientOrderId: "CL-NULL",
        tradeId: "T-999",
        symbol: "XAUUSD",
        direction: "LONG",
        lotSize: 0.1,
        orderType: "MARKET",
        stopLoss: 2000,
        takeProfit1: 2050,
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe("ORDER_REJECTED");
      expect(res.rejectionReason).toContain("Live Broker is not connected");
    });
  });

  describe("ExecutionEngine Boundary", () => {
    function makePlan(): TradePlan {
      return {
        id: "P-500",
        signalId: "SIG-500",
        symbol: "XAUUSD",
        direction: "LONG",
        entry: 2050.0,
        stopLoss: 2040.0,
        takeProfit1: 2070.0,
        takeProfit2: 2080.0,
        lotSize: 0.1,
        riskAmount: 100,
        mode: "PAPER_TRADING",
        createdAt: Date.now(),
      };
    }

    it("executes valid plans safely through PaperBrokerAdapter in PAPER_TRADING", async () => {
      const broker = new PaperBrokerAdapter({ initialBalance: 10_000 });
      const bus = new EventBus();
      const repo = new InMemoryRepository();
      const engine = new ExecutionEngine({ broker, bus, repo, instrumentSpec: DEFAULT_XAUUSD_SPEC });

      const plan = makePlan();
      const res = await engine.executePlan(plan, "PAPER_TRADING");
      expect(res.success).toBe(true);
      expect(res.status).toBe("ORDER_FILLED");
    });

    it("enforces execution idempotency for duplicate client order IDs", async () => {
      const broker = new PaperBrokerAdapter({ initialBalance: 10_000 });
      const bus = new EventBus();
      const repo = new InMemoryRepository();
      const engine = new ExecutionEngine({ broker, bus, repo });

      const plan = makePlan();
      const first = await engine.executePlan(plan, "PAPER_TRADING");
      const second = await engine.executePlan(plan, "PAPER_TRADING");

      expect(first).toBe(second); // Same cached result returned without duplicate order
      const positions = await broker.getOpenPositions();
      expect(positions).toHaveLength(1);
    });

    it("blocks order execution when KillSwitch is active", async () => {
      const broker = new PaperBrokerAdapter({ initialBalance: 10_000 });
      const bus = new EventBus();
      const repo = new InMemoryRepository();
      const killSwitch = new KillSwitch();
      await killSwitch.escalate("L2", "Test Emergency Lock");

      const engine = new ExecutionEngine({ broker, bus, repo, killSwitch });
      const plan = makePlan();
      const res = await engine.executePlan(plan, "PAPER_TRADING");

      expect(res.success).toBe(false);
      expect(res.status).toBe("ORDER_REJECTED");
      expect(res.rejectionReason).toContain("Blocked by active KillSwitch");
    });

    it("blocks AUTO_TRADING when live broker is unconfigured", async () => {
      const broker = new PaperBrokerAdapter({ initialBalance: 10_000 }); // Simulated broker
      const bus = new EventBus();
      const repo = new InMemoryRepository();
      const engine = new ExecutionEngine({ broker, bus, repo });

      const plan = makePlan();
      const res = await engine.executePlan(plan, "AUTO_TRADING");

      expect(res.success).toBe(false);
      expect(res.status).toBe("ORDER_REJECTED");
      expect(res.rejectionReason).toContain("AUTO_TRADING requires verified live broker adapter");
    });
  });
});
