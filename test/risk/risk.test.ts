import { describe, expect, it } from "vitest";
import { computeLotSize, evaluateRisk, evaluateBreaches, breachLevel } from "../../src/risk/RiskEngine.js";
import type { RiskConfig, RiskState, RiskEnvironment } from "../../src/risk/RiskEngine.js";
import type { Setup } from "../../src/core/types/Setup.js";

const CFG: RiskConfig = {
  perTradePct: 0.5,
  dailyLossCapPct: 3,
  weeklyLossCapPct: 6,
  maxDrawdownPct: 10,
  maxOpenTrades: 2,
  netExposureMax: 1.5,
  marginCeilingPct: 50,
  accountEquity: 10_000,
};

const CLEAN_STATE: RiskState = {
  openTrades: 0,
  netExposureLots: 0,
  marginUsedPct: 0,
  dailyLossPct: 0,
  weeklyLossPct: 0,
  maxDrawdownPct: 0,
};

const CLEAN_ENV: RiskEnvironment = { equity: 10_000, state: CLEAN_STATE, killSwitch: "NONE" };

const LONG_SETUP: Setup = {
  id: "sc:XAUUSD:M5:1",
  strategyId: "strong-candle",
  symbol: "XAUUSD",
  timeframe: "M5",
  direction: "LONG",
  barOpenTime: 1,
  createdAt: 1,
  state: "NEW",
  entry: 2000,
  stopLoss: 1990,
  takeProfit1: 2010,
  takeProfit2: 2020,
  invalidationPrice: 1990,
  rationale: "test",
  evidence: [],
};

describe("computeLotSize", () => {
  it("sizes XAUUSD lots from stop distance and risk budget", () => {
    // risk budget = 10_000 * 0.5% = $50; risk per lot = 10 * $100 = $1000 → 0.05 lots
    expect(computeLotSize(2000, 1990, 10_000, 0.5)).toBe(0.05);
  });

  it("floors to 0.01 lot steps to stay under budget", () => {
    // budget $50, stop 7 → risk/lot $700 → 0.0714… → 0.07
    expect(computeLotSize(2000, 1993, 10_000, 0.5)).toBe(0.07);
  });

  it("returns zero for degenerate stops", () => {
    expect(computeLotSize(2000, 2000, 10_000, 0.5)).toBe(0);
    expect(computeLotSize(2000, 1990, 0, 0.5)).toBe(0);
  });
});

describe("evaluateBreaches / breachLevel", () => {
  it("no breaches on clean state", () => {
    const b = evaluateBreaches(CFG, CLEAN_STATE);
    expect(Object.values(b).every((v) => !v)).toBe(true);
    expect(breachLevel(b)).toBe("NONE");
  });

  it("loss breaches escalate to L3", () => {
    const b = evaluateBreaches(CFG, { ...CLEAN_STATE, dailyLossPct: 3.5 });
    expect(b.dailyLossExceeded).toBe(true);
    expect(breachLevel(b)).toBe("L3");
    const b2 = evaluateBreaches(CFG, { ...CLEAN_STATE, maxDrawdownPct: 11 });
    expect(breachLevel(b2)).toBe("L3");
  });

  it("capacity breaches escalate to L2", () => {
    const b = evaluateBreaches(CFG, { ...CLEAN_STATE, openTrades: 2 });
    expect(b.maxOpenTradesExceeded).toBe(true);
    expect(breachLevel(b)).toBe("L2");
  });
});

describe("evaluateRisk", () => {
  it("approves a clean setup with the right lot size and risk amount", () => {
    const d = evaluateRisk(CFG, CLEAN_ENV, LONG_SETUP, "LONG");
    expect(d.verdict).toBe("APPROVED");
    expect(d.lotSize).toBe(0.05);
    expect(d.riskAmount).toBeCloseTo(10 * 100 * 0.05, 2); // $50
    expect(d.reasons).toHaveLength(0);
    expect(d.killSwitchLevel).toBe("NONE");
  });

  it("rejects when max open trades is reached", () => {
    const env: RiskEnvironment = { equity: 10_000, state: { ...CLEAN_STATE, openTrades: 2 }, killSwitch: "NONE" };
    const d = evaluateRisk(CFG, env, LONG_SETUP, "LONG");
    expect(d.verdict).toBe("REJECTED");
    expect(d.reasons.join(" ")).toMatch(/max open trades/);
  });

  it("rejects on L3 kill switch regardless of setup quality", () => {
    const env: RiskEnvironment = { equity: 10_000, state: { ...CLEAN_STATE, dailyLossPct: 5 }, killSwitch: "NONE" };
    const d = evaluateRisk(CFG, env, LONG_SETUP, "LONG");
    expect(d.verdict).toBe("REJECTED");
    expect(d.killSwitchLevel).toBe("L3");
  });

  it("rejects an inverted stop for the direction", () => {
    const bad = { ...LONG_SETUP, stopLoss: 2010 };
    const d = evaluateRisk(CFG, CLEAN_ENV, bad, "LONG");
    expect(d.verdict).toBe("REJECTED");
    expect(d.reasons.join(" ")).toMatch(/not below entry/);
  });

  it("rejects a zero lot size from an extreme stop distance", () => {
    const wide = { ...LONG_SETUP, stopLoss: 1000 };
    const d = evaluateRisk(CFG, CLEAN_ENV, wide, "LONG");
    expect(d.verdict).toBe("REJECTED");
    expect(d.reasons.join(" ")).toMatch(/lot size is zero/);
  });
});
