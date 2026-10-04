import { describe, expect, it, vi } from "vitest";
import { KillSwitch } from "../../src/risk/KillSwitch.js";
import { IdempotencyGuard } from "../../src/safety/IdempotencyGuard.js";
import { SimulatedProtection, protectionSpecFor } from "../../src/execution/BrokerProtection.js";
import { ReconciliationService, planToTrade } from "../../src/safety/Reconciliation.js";
import type { Trade, TradePlan } from "../../src/core/types/Trade.js";

const PLAN: TradePlan = {
  id: "tp:1",
  signalId: "sig:1",
  symbol: "XAUUSD",
  direction: "LONG",
  entry: 2000,
  stopLoss: 1990,
  takeProfit1: 2010,
  takeProfit2: 2020,
  lotSize: 0.05,
  riskAmount: 50,
  mode: "PAPER_TRADING",
  createdAt: 1,
};

describe("KillSwitch", () => {
  it("escalates monotonically and ignores lower requests", async () => {
    const persist = vi.fn(async () => {});
    const ks = new KillSwitch(persist, () => 100);
    expect(ks.level).toBe("NONE");
    await ks.escalate("L2", "capacity breach");
    expect(ks.level).toBe("L2");
    expect(ks.current.active).toBe(true);
    await ks.escalate("L1", "warning");
    expect(ks.level).toBe("L2"); // ignored — lower
    await ks.escalate("L3", "daily loss");
    expect(ks.level).toBe("L3");
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("persists and restores state across a restart", async () => {
    const ks = new KillSwitch(async () => {}, () => 100);
    await ks.escalate("L2", "breach");
    const saved = ks.current;
    const restored = new KillSwitch();
    restored.restore(saved);
    expect(restored.level).toBe("L2");
  });

  it("requires an explicit manual reset to de-escalate", async () => {
    const ks = new KillSwitch();
    await ks.escalate("L3", "halt");
    await ks.reset("manual all-clear", "operator");
    expect(ks.level).toBe("NONE");
    expect(ks.current.updatedBy).toBe("operator");
  });
});

describe("IdempotencyGuard", () => {
  it("claims each bar exactly once", () => {
    const g = new IdempotencyGuard();
    expect(g.claim("XAUUSD", "M5", 100)).toBe(true);
    expect(g.claim("XAUUSD", "M5", 100)).toBe(false);
    expect(g.claim("XAUUSD", "M5", 200)).toBe(true);
  });

  it("tracks a high-water mark per series and rejects stale bars", () => {
    const g = new IdempotencyGuard();
    g.claim("XAUUSD", "M5", 200);
    expect(g.highWaterMark("XAUUSD", "M5")).toBe(200);
    expect(g.claimIfNewer({ symbol: "XAUUSD", timeframe: "M5", openTime: 100 } as never)).toBe(false);
    expect(g.claimIfNewer({ symbol: "XAUUSD", timeframe: "M5", openTime: 300 } as never)).toBe(true);
  });

  it("evicts old entries without losing the high-water guard", () => {
    const g = new IdempotencyGuard(4);
    for (let i = 0; i < 10; i++) g.claim("XAUUSD", "M5", i * 100);
    expect(g.highWaterMark("XAUUSD", "M5")).toBe(900);
    expect(g.claimIfNewer({ symbol: "XAUUSD", timeframe: "M5", openTime: 500 } as never)).toBe(false);
  });
});

describe("BrokerProtection", () => {
  it("places, lists and releases protective orders idempotently", async () => {
    const p = new SimulatedProtection();
    const spec = protectionSpecFor(PLAN);
    await p.protect(spec);
    await p.protect(spec); // idempotent
    expect(await p.list()).toHaveLength(1);
    await p.release(PLAN.id);
    expect(await p.list()).toHaveLength(0);
  });
});

describe("ReconciliationService", () => {
  const trade = planToTrade(PLAN, "OPEN");

  it("flags an open trade missing venue protection", async () => {
    const svc = new ReconciliationService(new SimulatedProtection());
    const mismatches = await svc.reconcile([trade], 0.5);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.kind).toBe("MISSING_PROTECTION");
  });

  it("reports no mismatch when protection is in place", async () => {
    const protection = new SimulatedProtection();
    await protection.protect(protectionSpecFor(PLAN));
    const svc = new ReconciliationService(protection);
    expect(await svc.reconcile([trade], 0.5)).toHaveLength(0);
  });

  it("flags price drift beyond tolerance", async () => {
    const protection = new SimulatedProtection();
    await protection.protect({ tradeId: PLAN.id, symbol: "XAUUSD", side: "LONG", stopLoss: 1980, takeProfit: 2010 });
    const svc = new ReconciliationService(protection);
    const mismatches = await svc.reconcile([trade], 0.5);
    expect(mismatches.some((m) => m.kind === "PRICE_DRIFT")).toBe(true);
  });

  it("flags venue protection with no matching open trade", async () => {
    const protection = new SimulatedProtection();
    await protection.protect({ tradeId: "ghost", symbol: "XAUUSD", side: "LONG", stopLoss: 1, takeProfit: 2 });
    const svc = new ReconciliationService(protection);
    const mismatches = await svc.reconcile([], 0.5);
    expect(mismatches.some((m) => m.kind === "PROTECTION_WITHOUT_TRADE")).toBe(true);
  });

  it("repairs missing protection by re-placing orders", async () => {
    const protection = new SimulatedProtection();
    const svc = new ReconciliationService(protection);
    const repaired = await svc.repair([trade]);
    expect(repaired).toBe(1);
    expect(await protection.list()).toHaveLength(1);
  });
});
