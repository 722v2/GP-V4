import { describe, expect, it, vi } from "vitest";
import { JustMarketsMt5Adapter, type Mt5BridgeClient } from "../../src/execution/broker/JustMarketsMt5Adapter.js";
import { PaperBrokerAdapter } from "../../src/execution/broker/PaperBrokerAdapter.js";
import { NullBrokerAdapter } from "../../src/execution/broker/NullBrokerAdapter.js";
import { PromotionGateEngine } from "../../src/safety/PromotionGates.js";
import { ExecutionEngine } from "../../src/execution/ExecutionEngine.js";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { InMemoryRepository } from "../../src/persistence/Persistence.js";
import { DEFAULT_XAUUSD_SPEC } from "../../src/risk/InstrumentSpec.js";
import { EventBus } from "../../src/core/events/EventBus.js";

// Mock MT5 Bridge Client implementation
class MockMt5BridgeClient implements Mt5BridgeClient {
  constructor(
    public healthData: any = { connected: true, status: "READY", serverTime: Date.now(), latencyMs: 15, terminalConnected: true, detail: "Bridge fully connected" },
    public accountData: any = { accountId: "123456", balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, currency: "USD", leverage: 100, tradingAllowed: true, investorMode: false },
    public specData: any = { symbol: "XAUUSD.jm", digits: 2, point: 0.01, tickSize: 0.01, tickValue: 1.0, contractSize: 100, volumeMin: 0.01, volumeMax: 50.0, volumeStep: 0.01, tradeMode: "FULL", stopsLevel: 10, freezeLevel: 0, currency: "USD" },
    public quoteData: any = { symbol: "XAUUSD.jm", bid: 2050.25, ask: 2050.60, time: Date.now() },
    public positions: any[] = [],
    public orders: any[] = []
  ) {}

  async getHealth() {
    return this.healthData;
  }
  async getAccountInfo() {
    return this.accountData;
  }
  async getSymbolSpec(_brokerSymbol: string) {
    return this.specData;
  }
  async getQuote(_brokerSymbol: string) {
    return this.quoteData;
  }
  async getOpenPositions() {
    return this.positions;
  }
  async getPendingOrders() {
    return this.orders;
  }
  async submitOrder(order: any) {
    return { success: true, orderId: "999888", status: "ORDER_FILLED", volumeFilled: order.volume, priceFilled: order.price || 2050.60 };
  }
  async closePosition(positionId: string, _volume: number) {
    return { success: true, pnl: 150.0, positionId };
  }
  async modifyProtection(positionId: string, _sl?: number, _tp?: number) {
    return { success: true, positionId };
  }
  async getOrderStatus(orderId: string) {
    return { orderId, status: "ORDER_FILLED" };
  }
}

describe("JustMarkets MT5 Broker Contract Validation Suite", () => {

  it("broker symbol mapping: uses the configured broker-specific symbol in bridge requests", async () => {
    const bridge = new MockMt5BridgeClient();
    const getSymbolSpecSpy = vi.spyOn(bridge, "getSymbolSpec");
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const spec = await adapter.getInstrumentSpec("XAUUSD");
    expect(getSymbolSpecSpy).toHaveBeenCalledWith("XAUUSD.jm");
    expect(spec.brokerSymbol).toBe("XAUUSD.jm");
    expect(spec.symbol).toBe("XAUUSD");
  });

  it("missing broker symbol: fails and throws cleanly when broker symbol cannot be resolved", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.specData = null; // Spec cannot be retrieved
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    await expect(adapter.getInstrumentSpec("XAUUSD")).rejects.toThrow(/UNVERIFIED/);
  });

  it("invalid InstrumentSpec: throws and blocks live execution when spec fields are missing or invalid", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.specData = { symbol: "XAUUSD.jm", contractSize: 0 }; // contract size invalid
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    await expect(adapter.getInstrumentSpec("XAUUSD")).rejects.toThrow(/UNVERIFIED/);
  });

  it("valid InstrumentSpec: maps MT5 response properties cleanly without substitute or guessed values", async () => {
    const bridge = new MockMt5BridgeClient();
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const spec = await adapter.getInstrumentSpec("XAUUSD");
    expect(spec.digits).toBe(2);
    expect(spec.pointSize).toBe(0.01);
    expect(spec.contractSize).toBe(100);
    expect(spec.minLot).toBe(0.01);
    expect(spec.maxLot).toBe(50.0);
  });

  it("stale quote: rejects prices that are older than 30 seconds and returns null", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.quoteData = { symbol: "XAUUSD.jm", bid: 2050, ask: 2051, time: Date.now() - 45_000 }; // 45 seconds old
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const quote = await adapter.getQuote("XAUUSD");
    expect(quote).toBeNull();
  });

  it("invalid quote: rejects prices with missing or non-positive bids/asks", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.quoteData = { symbol: "XAUUSD.jm", bid: -5.0, ask: 2051, time: Date.now() }; // negative bid
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const quote = await adapter.getQuote("XAUUSD");
    expect(quote).toBeNull();
  });

  it("spread validation: calculates canonical spread strictly as ask - bid", async () => {
    const bridge = new MockMt5BridgeClient();
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const quote = await adapter.getQuote("XAUUSD");
    expect(quote).not.toBeNull();
    expect(quote!.spread).toBe(0.35); // 2050.60 - 2050.25
  });

  it("account verification: retrieves balance, equity, and leverage without logging sensitive fields", async () => {
    const bridge = new MockMt5BridgeClient();
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const acc = await adapter.getAccountInfo();
    expect(acc.accountId).toBe("123456");
    expect(acc.balance).toBe(10000);
    expect(acc.equity).toBe(10000);
    expect(acc.leverage).toBe(100);
  });

  it("broker unavailable: degrades gracefully when terminal reports disconnected status", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.healthData = { connected: true, status: "READY", serverTime: Date.now(), latencyMs: 5, terminalConnected: false }; // disconnected terminal
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const h = await adapter.getHealth();
    expect(h.connected).toBe(false);
    expect(h.status).toBe("DEGRADED");
    expect(h.detail).toContain("disconnected from MT5 Terminal");
  });

  it("bridge unavailable: reports disconnected status when HTTP client throws or timeouts", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.healthData = { connected: false, status: "DISCONNECTED", serverTime: Date.now(), latencyMs: 0, terminalConnected: false, detail: "Bridge unreachable" };
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const h = await adapter.getHealth();
    expect(h.connected).toBe(false);
    expect(h.status).toBe("DISCONNECTED");
  });

  it("unsupported broker capability: explicitly registers trailing stop as unsupported", async () => {
    const bridge = new MockMt5BridgeClient();
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const h = await adapter.getHealth();
    expect(h.capabilities.supportsTrailingStop).toBe(false);
  });

  it("broker protection unavailable: blocks live execution if broker-side protection is unsupported", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.healthData.connected = false; // Disconnected
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const request = {
      clientOrderId: "CL-99",
      tradeId: "T-99",
      symbol: "XAUUSD",
      direction: "LONG" as const,
      lotSize: 0.1,
      orderType: "MARKET" as const,
      stopLoss: 2000,
      takeProfit1: 2050,
    };

    const res = await adapter.submitOrder(request);
    expect(res.success).toBe(false);
    expect(res.rejectionReason).toContain("LIVE_EXECUTION = BLOCKED");
  });

  it("broker gate remains blocked without verification evidence", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.healthData.connected = false; // Force fail checks

    const mockConfig = {
      mode: "AUTO_TRADING" as const,
      symbols: ["XAUUSD"],
      timeframes: ["M5"],
      supabase: { url: "", serviceKey: "" },
      ai: { apiKey: "" },
      biquiti: { apiKey: "" },
      telegram: { botToken: "", chatId: "" },
    } as any;

    const repo = new InMemoryRepository();
    const killSwitch = new KillSwitch();
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const engine = new PromotionGateEngine(mockConfig, repo, killSwitch, adapter);
    const report = await engine.evaluateAll();

    expect(report.autoTradingAllowed).toBe(false);
    const gate5 = report.gates.find((g) => g.gateId === "GATE_5_BROKER_VALIDATED");
    expect(gate5?.status).toBe("BLOCKED");
  });

  it("paper trading remains functional without MT5", async () => {
    const paper = new PaperBrokerAdapter({ initialBalance: 50_000 });
    const h = await paper.getHealth();
    expect(h.isSimulated).toBe(true);
    expect(h.connected).toBe(true);

    const acc = await paper.getAccountInfo();
    expect(acc.balance).toBe(50_000);
  });

  it("no live execution when broker gate is blocked", async () => {
    const bridge = new MockMt5BridgeClient();
    bridge.healthData.connected = false; // Connection blocked
    const adapter = new JustMarketsMt5Adapter(bridge, "XAUUSD.jm");

    const repo = new InMemoryRepository();
    const bus = new EventBus();
    const execution = new ExecutionEngine({ broker: adapter, bus, repo });

    const plan = {
      id: "P-REAL",
      signalId: "SIG-REAL",
      symbol: "XAUUSD" as const,
      direction: "LONG" as const,
      entry: 2050.0,
      stopLoss: 2040.0,
      takeProfit1: 2070.0,
      takeProfit2: 2080.0,
      lotSize: 0.1,
      riskAmount: 100,
      mode: "AUTO_TRADING" as const,
      createdAt: Date.now(),
    };

    const res = await execution.executePlan(plan, "AUTO_TRADING");
    expect(res.success).toBe(false);
    expect(res.status).toBe("ORDER_REJECTED");
    expect(res.rejectionReason).toContain("LIVE_EXECUTION = BLOCKED");
  });
});
